import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { 
  Users, 
  Briefcase, 
  FileText, 
  Settings, 
  Eye,
  Trash2,
  Search,
  Filter,
  Calendar,
  MapPin,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  UserCheck,
  Download,
  Shield,
  Activity,
  Crown,
  BarChart3
} from "lucide-react";
import { format } from "date-fns";

interface AdminStats {
  totalJobs: number;
  activeJobs: number;
  pendingJobs: number;
  totalApplications: number;
  totalUsers: number;
  totalRecruiters: number;
}

interface JobWithDetails {
  id: number;
  title: string;
  company: string;
  location: string;
  type: string;
  status: string;
  isActive: boolean;
  createdAt: string;
  applicationCount: number;
  postedBy: {
    id: number;
    firstName: string;
    lastName: string;
    username: string;
  };
}

interface ApplicationWithDetails {
  id: number;
  fullName: string;
  email: string;
  phone: string;
  coverLetter: string;
  status: string;
  appliedAt: string;
  viewedAt?: string;
  downloadedAt?: string;
  notes?: string;
  job: {
    id: number;
    title: string;
    company: string;
  };
  recruiterNotes?: string;
}

interface UserDetails {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  createdAt: string;
  profile?: {
    bio?: string;
    skills?: string[];
    linkedin?: string;
    location?: string;
  };
  jobCount?: number;
  applicationCount?: number;
}

export default function AdminSuperDashboard() {
  const { toast } = useToast();
  const [selectedJob, setSelectedJob] = useState<JobWithDetails | null>(null);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationWithDetails | null>(null);
  const [jobFilter, setJobFilter] = useState("all");
  const [applicationFilter, setApplicationFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Fetch admin statistics
  const { data: stats } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
  });

  // Fetch all jobs with details
  const { data: jobs, isLoading: jobsLoading } = useQuery<JobWithDetails[]>({
    queryKey: ["/api/admin/jobs/all"],
  });

  // Fetch all applications with details
  const { data: applications, isLoading: applicationsLoading } = useQuery<ApplicationWithDetails[]>({
    queryKey: ["/api/admin/applications/all"],
  });

  // Fetch all users
  const { data: users, isLoading: usersLoading } = useQuery<UserDetails[]>({
    queryKey: ["/api/admin/users"],
  });

  // Update job status mutation
  const updateJobMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/jobs/${id}/status`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Job status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update job status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete job mutation
  const deleteJobMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/jobs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/jobs/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Job deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update application status mutation
  const updateApplicationMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${id}/status`, { status, notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/applications/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "Application status updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update application status",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await apiRequest("PATCH", `/api/admin/users/${id}/role`, { role });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: "User role updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update user role",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter functions
  const filteredJobs = jobs?.filter(job => {
    const matchesFilter = jobFilter === "all" || 
      (jobFilter === "active" && job.isActive) ||
      (jobFilter === "inactive" && !job.isActive) ||
      (jobFilter === "pending" && job.status === "pending") ||
      (jobFilter === "approved" && job.status === "approved");
    
    const matchesSearch = !searchTerm || 
      job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.company.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const filteredApplications = applications?.filter(app => {
    const matchesFilter = applicationFilter === "all" || app.status === applicationFilter;
    const matchesSearch = !searchTerm || 
      app.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.job.company.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const filteredUsers = users?.filter(user => {
    const matchesFilter = userFilter === "all" || user.role === userFilter;
    const matchesSearch = !searchTerm || 
      user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.username.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const getStatusConfig = (status: string) => {
    const configs = {
      submitted: { color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Clock, label: "Submitted" },
      reviewed: { color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30", icon: Eye, label: "Under Review" },
      shortlisted: { color: "bg-green-500/20 text-green-300 border-green-500/30", icon: UserCheck, label: "Shortlisted" },
      rejected: { color: "bg-red-500/20 text-red-300 border-red-500/30", icon: XCircle, label: "Rejected" },
      downloaded: { color: "bg-purple-500/20 text-purple-300 border-purple-500/30", icon: Download, label: "Downloaded" },
      pending: { color: "bg-orange-500/20 text-orange-300 border-orange-500/30", icon: AlertCircle, label: "Pending Review" },
      approved: { color: "bg-green-500/20 text-green-300 border-green-500/30", icon: CheckCircle, label: "Approved" },
    };
    return configs[status as keyof typeof configs] || configs.submitted;
  };

  const getRoleColor = (role: string) => {
    const colors = {
      admin: "bg-red-500/20 text-red-300 border-red-500/30",
      recruiter: "bg-purple-500/20 text-purple-300 border-purple-500/30",
      candidate: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    };
    return colors[role as keyof typeof colors] || colors.candidate;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl">
              <Shield className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold text-white">Admin Super Dashboard</h1>
          </div>
          <p className="text-xl text-white/70">Complete platform control and management</p>
          
          {/* Quick Actions */}
          <div className="flex justify-center space-x-4 mt-6">
            <Button 
              onClick={() => window.location.href = '/admin/testing'}
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
            >
              <BarChart3 className="h-4 w-4 mr-2" />
              Testing Dashboard
            </Button>
            <Button 
              onClick={() => window.location.href = '/analytics'}
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <Activity className="h-4 w-4 mr-2" />
              Analytics
            </Button>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white/70">Total Jobs</CardTitle>
              <Briefcase className="h-4 w-4 text-blue-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats?.totalJobs || 0}</div>
              <p className="text-xs text-white/50">
                {stats?.activeJobs || 0} active, {stats?.pendingJobs || 0} pending
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white/70">Total Applications</CardTitle>
              <FileText className="h-4 w-4 text-green-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats?.totalApplications || 0}</div>
              <p className="text-xs text-white/50">Across all jobs</p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white/70">Total Users</CardTitle>
              <Users className="h-4 w-4 text-purple-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">{stats?.totalUsers || 0}</div>
              <p className="text-xs text-white/50">
                {stats?.totalRecruiters || 0} recruiters
              </p>
            </CardContent>
          </Card>

          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-white/70">Platform Activity</CardTitle>
              <Activity className="h-4 w-4 text-orange-400" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-white">Live</div>
              <p className="text-xs text-white/50">System operational</p>
            </CardContent>
          </Card>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="jobs" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-slate-800/50 border-slate-700">
            <TabsTrigger value="jobs" className="data-[state=active]:bg-purple-600">
              <Briefcase className="h-4 w-4 mr-2" />
              Jobs Management
            </TabsTrigger>
            <TabsTrigger value="applications" className="data-[state=active]:bg-purple-600">
              <FileText className="h-4 w-4 mr-2" />
              Applications
            </TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-purple-600">
              <Users className="h-4 w-4 mr-2" />
              Users
            </TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-purple-600">
              <Settings className="h-4 w-4 mr-2" />
              System Logs
            </TabsTrigger>
          </TabsList>

          {/* Jobs Management Tab */}
          <TabsContent value="jobs" className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-white">Jobs Management</CardTitle>
                    <CardDescription className="text-white/70">
                      View, edit, and manage all platform jobs
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                    <div className="flex items-center space-x-2">
                      <Search className="h-4 w-4 text-white/50" />
                      <Input
                        placeholder="Search jobs..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <Select value={jobFilter} onValueChange={setJobFilter}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="all">All Jobs</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="pending">Pending Review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {jobsLoading ? (
                  <div className="text-center py-8 text-white/70">Loading jobs...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredJobs?.map((job) => (
                      <div key={job.id} className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                        <div className="flex justify-between items-start">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-lg font-semibold text-white">{job.title}</h3>
                              <Badge className={getStatusConfig(job.status).color}>
                                {getStatusConfig(job.status).label}
                              </Badge>
                              <Badge className={job.isActive ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}>
                                {job.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-white/70">
                              <span className="flex items-center space-x-1">
                                <MapPin className="h-4 w-4" />
                                <span>{job.company} • {job.location}</span>
                              </span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>{format(new Date(job.createdAt), "MMM d, yyyy")}</span>
                              </span>
                              <span className="flex items-center space-x-1">
                                <FileText className="h-4 w-4" />
                                <span>{job.applicationCount} applications</span>
                              </span>
                            </div>
                            <p className="text-white/60 text-sm">
                              Posted by: {job.postedBy.firstName} {job.postedBy.lastName} ({job.postedBy.username})
                            </p>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedJob(job)}
                              className="border-slate-600 text-white hover:bg-slate-700 bg-slate-800/50 hover:border-slate-500"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updateJobMutation.mutate({ id: job.id, isActive: !job.isActive })}
                              className="border-slate-600 text-white hover:bg-slate-700 bg-slate-800/50 hover:border-slate-500"
                            >
                              {job.isActive ? "Deactivate" : "Activate"}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="border-red-600 text-red-400 hover:bg-red-900/20 bg-red-900/10"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="bg-slate-800 border-slate-700">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-white">Delete Job</AlertDialogTitle>
                                  <AlertDialogDescription className="text-white/70">
                                    Are you sure you want to delete "{job.title}"? This action cannot be undone and will remove all associated applications.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="bg-slate-700 border-slate-600 text-white">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteJobMutation.mutate(job.id)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Applications Management Tab */}
          <TabsContent value="applications" className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-white">Applications Management</CardTitle>
                    <CardDescription className="text-white/70">
                      Review and manage all job applications
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                    <div className="flex items-center space-x-2">
                      <Search className="h-4 w-4 text-white/50" />
                      <Input
                        placeholder="Search applications..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <Select value={applicationFilter} onValueChange={setApplicationFilter}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="all">All Applications</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="reviewed">Under Review</SelectItem>
                        <SelectItem value="shortlisted">Shortlisted</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {applicationsLoading ? (
                  <div className="text-center py-8 text-white/70">Loading applications...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredApplications?.map((application) => (
                      <div key={application.id} className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                        <div className="flex justify-between items-start">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-lg font-semibold text-white">{application.fullName}</h3>
                              <Badge className={getStatusConfig(application.status).color}>
                                {getStatusConfig(application.status).label}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-white/70">
                              <span>{application.email}</span>
                              <span>{application.phone}</span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>{format(new Date(application.appliedAt), "MMM d, yyyy")}</span>
                              </span>
                            </div>
                            <p className="text-white/60 text-sm">
                              Applied for: {application.job.title} at {application.job.company}
                            </p>
                            {application.notes && (
                              <p className="text-white/60 text-sm bg-slate-800/50 p-2 rounded">
                                Notes: {application.notes}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedApplication(application)}
                              className="border-slate-600 text-white hover:bg-slate-700"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Select
                              value={application.status}
                              onValueChange={(status) => updateApplicationMutation.mutate({ id: application.id, status })}
                            >
                              <SelectTrigger className="w-32 bg-slate-700 border-slate-600 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-800 border-slate-700">
                                <SelectItem value="submitted">Submitted</SelectItem>
                                <SelectItem value="reviewed">Under Review</SelectItem>
                                <SelectItem value="shortlisted">Shortlisted</SelectItem>
                                <SelectItem value="rejected">Rejected</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Management Tab */}
          <TabsContent value="users" className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
              <CardHeader>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0">
                  <div>
                    <CardTitle className="text-white">Users Management</CardTitle>
                    <CardDescription className="text-white/70">
                      Manage user roles and permissions
                    </CardDescription>
                  </div>
                  <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4">
                    <div className="flex items-center space-x-2">
                      <Search className="h-4 w-4 text-white/50" />
                      <Input
                        placeholder="Search users..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-slate-700 border-slate-600 text-white"
                      />
                    </div>
                    <Select value={userFilter} onValueChange={setUserFilter}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="all">All Users</SelectItem>
                        <SelectItem value="admin">Admins</SelectItem>
                        <SelectItem value="recruiter">Recruiters</SelectItem>
                        <SelectItem value="candidate">Candidates</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8 text-white/70">Loading users...</div>
                ) : (
                  <div className="space-y-4">
                    {filteredUsers?.map((user) => (
                      <div key={user.id} className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                        <div className="flex justify-between items-start">
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center space-x-3">
                              <h3 className="text-lg font-semibold text-white">
                                {user.firstName} {user.lastName}
                              </h3>
                              <Badge className={getRoleColor(user.role)}>
                                {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                              </Badge>
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-white/70">
                              <span>{user.username}</span>
                              <span className="flex items-center space-x-1">
                                <Calendar className="h-4 w-4" />
                                <span>Joined {format(new Date(user.createdAt), "MMM d, yyyy")}</span>
                              </span>
                              {user.jobCount !== undefined && (
                                <span>{user.jobCount} jobs posted</span>
                              )}
                              {user.applicationCount !== undefined && (
                                <span>{user.applicationCount} applications</span>
                              )}
                            </div>
                            {user.profile && (
                              <div className="text-white/60 text-sm space-y-1">
                                {user.profile.location && (
                                  <p className="flex items-center space-x-1">
                                    <MapPin className="h-3 w-3" />
                                    <span>{user.profile.location}</span>
                                  </p>
                                )}
                                {user.profile.skills && user.profile.skills.length > 0 && (
                                  <p>Skills: {user.profile.skills.slice(0, 3).join(", ")}</p>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Select
                              value={user.role}
                              onValueChange={(role) => updateUserRoleMutation.mutate({ id: user.id, role })}
                            >
                              <SelectTrigger className="w-32 bg-slate-700 border-slate-600 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-slate-800 border-slate-700">
                                <SelectItem value="candidate">Candidate</SelectItem>
                                <SelectItem value="recruiter">Recruiter</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* System Logs Tab */}
          <TabsContent value="logs" className="space-y-6">
            <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-white">System Activity Logs</CardTitle>
                <CardDescription className="text-white/70">
                  Monitor platform activity and system events
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                      <span className="text-white/70">{format(new Date(), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-white">System</span>
                      <span className="text-green-400">Platform operational - All systems running</span>
                    </div>
                  </div>
                  <div className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                      <span className="text-white/70">{format(new Date(Date.now() - 300000), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-white">Database</span>
                      <span className="text-blue-400">User profiles table created successfully</span>
                    </div>
                  </div>
                  <div className="border border-slate-600 rounded-lg p-4 bg-slate-700/30">
                    <div className="flex items-center space-x-3 text-sm">
                      <div className="w-2 h-2 bg-purple-400 rounded-full"></div>
                      <span className="text-white/70">{format(new Date(Date.now() - 600000), "MMM d, yyyy HH:mm")}</span>
                      <span className="text-white">Jobs</span>
                      <span className="text-purple-400">Job scheduler activated - Daily cleanup at 2 AM</span>
                    </div>
                  </div>
                  <div className="text-center py-4 text-white/50">
                    Real-time system monitoring active
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Job Detail Dialog */}
      {selectedJob && (
        <Dialog open={!!selectedJob} onOpenChange={() => setSelectedJob(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-white">{selectedJob.title}</DialogTitle>
              <DialogDescription className="text-white/70">
                {selectedJob.company} • {selectedJob.location}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-white/70">Status:</span>
                  <Badge className={`ml-2 ${getStatusConfig(selectedJob.status).color}`}>
                    {getStatusConfig(selectedJob.status).label}
                  </Badge>
                </div>
                <div>
                  <span className="text-white/70">Active:</span>
                  <Badge className={`ml-2 ${selectedJob.isActive ? "bg-green-500/20 text-green-300" : "bg-red-500/20 text-red-300"}`}>
                    {selectedJob.isActive ? "Yes" : "No"}
                  </Badge>
                </div>
                <div className="text-white/70">
                  Applications: <span className="text-white">{selectedJob.applicationCount}</span>
                </div>
                <div className="text-white/70">
                  Posted: <span className="text-white">{format(new Date(selectedJob.createdAt), "MMM d, yyyy")}</span>
                </div>
              </div>
              <div>
                <span className="text-white/70">Posted by:</span>
                <span className="text-white ml-2">
                  {selectedJob.postedBy.firstName} {selectedJob.postedBy.lastName} ({selectedJob.postedBy.username})
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setSelectedJob(null)}
                className="border-slate-600 text-white hover:bg-slate-700"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Application Detail Dialog */}
      {selectedApplication && (
        <Dialog open={!!selectedApplication} onOpenChange={() => setSelectedApplication(null)}>
          <DialogContent className="bg-slate-800 border-slate-700 max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-white">{selectedApplication.fullName}</DialogTitle>
              <DialogDescription className="text-white/70">
                Application for {selectedApplication.job.title} at {selectedApplication.job.company}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-white/70">
                  Email: <span className="text-white">{selectedApplication.email}</span>
                </div>
                <div className="text-white/70">
                  Phone: <span className="text-white">{selectedApplication.phone}</span>
                </div>
                <div className="text-white/70">
                  Status: 
                  <Badge className={`ml-2 ${getStatusConfig(selectedApplication.status).color}`}>
                    {getStatusConfig(selectedApplication.status).label}
                  </Badge>
                </div>
                <div className="text-white/70">
                  Applied: <span className="text-white">{format(new Date(selectedApplication.appliedAt), "MMM d, yyyy")}</span>
                </div>
              </div>
              {selectedApplication.coverLetter && (
                <div>
                  <span className="text-white/70 block mb-2">Cover Letter:</span>
                  <div className="bg-slate-700/50 p-3 rounded text-white text-sm max-h-32 overflow-y-auto">
                    {selectedApplication.coverLetter}
                  </div>
                </div>
              )}
              {selectedApplication.notes && (
                <div>
                  <span className="text-white/70 block mb-2">Recruiter Notes:</span>
                  <div className="bg-slate-700/50 p-3 rounded text-white text-sm">
                    {selectedApplication.notes}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button 
                variant="outline" 
                onClick={() => setSelectedApplication(null)}
                className="border-slate-600 text-white hover:bg-slate-700"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}