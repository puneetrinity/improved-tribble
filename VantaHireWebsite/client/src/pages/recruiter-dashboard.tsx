import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, Download, FileText, Users, Briefcase, Clock, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function RecruiterDashboard() {
  const { toast } = useToast();
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [newStatus, setNewStatus] = useState("");
  // SpotAxis integration flag (must be inside component for hooks correctness)
  const { data: spotaxis } = useQuery<{ enabled: boolean }>(["spotaxis-config"], async () => {
    const res = await fetch('/api/integrations/spotaxis');
    return res.json();
  });

  // Fetch recruiter's jobs
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["/api/my-jobs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/my-jobs");
      return await res.json();
    },
  });

  // Fetch all applications for recruiter's jobs
  const { data: applications = [], isLoading: applicationsLoading } = useQuery({
    queryKey: ["/api/my-applications-received"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/my-applications-received");
      return await res.json();
    },
  });

  // Update application status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ applicationId, status, notes }: { applicationId: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/status`, {
        status,
        reviewNotes: notes
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications-received"] });
      toast({
        title: "Application Updated",
        description: "Application status has been updated successfully.",
      });
      setSelectedApplicationId(null);
      setReviewNotes("");
      setNewStatus("");
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Download resume mutation
  const downloadResumeMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      await apiRequest("PATCH", `/api/applications/${applicationId}/download`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications-received"] });
    },
  });

  const handleStatusUpdate = () => {
    if (selectedApplicationId && newStatus) {
      updateStatusMutation.mutate({
        applicationId: selectedApplicationId,
        status: newStatus,
        notes: reviewNotes
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'reviewed': return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'shortlisted': return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'rejected': return 'bg-red-500/10 text-red-500 border-red-500/20';
      default: return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
    }
  };

  const getJobStats = () => {
    const totalJobs = jobs.length;
    const activeJobs = jobs.filter((job: any) => job.status === 'active').length;
    const totalApplications = applications.length;
    const pendingApplications = applications.filter((app: any) => app.status === 'pending').length;

    return { totalJobs, activeJobs, totalApplications, pendingApplications };
  };

  const stats = getJobStats();

  if (jobsLoading || applicationsLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#1E0B40] via-[#2D1B69] to-[#1E0B40]">
        <Header />
        <div className="container mx-auto px-4 pt-32 pb-16">
          <div className="flex items-center justify-center h-64">
            <div className="text-white">Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1E0B40] via-[#2D1B69] to-[#1E0B40]">
      <Header />
      <div className="container mx-auto px-4 pt-32 pb-16">
        <div className="space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <h1 className="text-4xl font-bold text-white">Recruiter Dashboard</h1>
            <p className="text-white/70 text-lg">Manage your job postings and applications</p>
          </div>

          {spotaxis?.enabled && (
            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardHeader>
                <CardTitle className="text-white">Manage on SpotAxis</CardTitle>
                <CardDescription className="text-white/70">Access advanced job management, pipelines, and collaborative hiring.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <a href="/spotaxis/recruiter" className="inline-block">
                  <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                    Recruiter Profile <ExternalLink className="h-4 w-4 ml-2" />
                  </Button>
                </a>
                <a href="/spotaxis/job/new" className="inline-block">
                  <Button className="bg-gradient-to-r from-purple-500 to-blue-500">
                    Create Job <ExternalLink className="h-4 w-4 ml-2" />
                  </Button>
                </a>
                <a href="/spotaxis/jobs" className="inline-block">
                  <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                    Careers / Job Board <ExternalLink className="h-4 w-4 ml-2" />
                  </Button>
                </a>
                <a href="/spotaxis/admin" className="inline-block">
                  <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                    Admin <ExternalLink className="h-4 w-4 ml-2" />
                  </Button>
                </a>
              </CardContent>
            </Card>
          )}

          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <Briefcase className="h-8 w-8 text-[#7B38FB]" />
                  <div>
                    <p className="text-white/70 text-sm">Total Jobs</p>
                    <p className="text-white text-2xl font-bold" data-testid="total-jobs">{stats.totalJobs}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <CheckCircle className="h-8 w-8 text-green-400" />
                  <div>
                    <p className="text-white/70 text-sm">Active Jobs</p>
                    <p className="text-white text-2xl font-bold">{stats.activeJobs}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <Users className="h-8 w-8 text-blue-400" />
                  <div>
                    <p className="text-white/70 text-sm">Total Applications</p>
                    <p className="text-white text-2xl font-bold">{stats.totalApplications}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center space-x-4">
                  <Clock className="h-8 w-8 text-yellow-400" />
                  <div>
                    <p className="text-white/70 text-sm">Pending Reviews</p>
                    <p className="text-white text-2xl font-bold" data-testid="pending-reviews">{stats.pendingApplications}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <Tabs defaultValue="applications" className="space-y-6">
            <TabsList className="bg-white/10 backdrop-blur-sm border-white/20">
              <TabsTrigger value="applications" className="data-[state=active]:bg-white/20">
                Applications
              </TabsTrigger>
              <TabsTrigger value="jobs" className="data-[state=active]:bg-white/20">
                My Job Postings
              </TabsTrigger>
            </TabsList>

            {/* Applications Tab */}
            <TabsContent value="applications">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <CardTitle className="text-white">Application Management</CardTitle>
                  <CardDescription className="text-white/70">
                    Review and manage candidate applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {applications.length === 0 ? (
                      <div className="text-center py-8">
                        <Users className="h-12 w-12 text-white/30 mx-auto mb-4" />
                        <p className="text-white/70">No applications received yet</p>
                      </div>
                    ) : (
                      applications.map((application: any) => (
                        <div
                          key={application.id}
                          className="p-4 rounded-lg bg-white/5 border border-white/10 space-y-3"
                          data-testid="application-row"
                        >
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <h3 className="text-white font-medium">{application.name}</h3>
                              <p className="text-white/70 text-sm">{application.email}</p>
                              <p className="text-white/60 text-sm">Applied for: {application.job?.title}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge className={getStatusColor(application.status)}>
                                {application.status}
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedApplicationId(application.id)}
                                className="border-white/20 text-white hover:bg-white/10"
                                data-testid="review-application"
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                Review
                              </Button>
                              {application.resumeUrl && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    downloadResumeMutation.mutate(application.id);
                                    window.open(application.resumeUrl, '_blank');
                                  }}
                                  className="border-white/20 text-white hover:bg-white/10"
                                >
                                  <Download className="h-4 w-4 mr-1" />
                                  Resume
                                </Button>
                              )}
                            </div>
                          </div>

                          {application.coverLetter && (
                            <div className="pt-2 border-t border-white/10">
                              <p className="text-white/70 text-sm">
                                <strong>Cover Letter:</strong> {application.coverLetter}
                              </p>
                            </div>
                          )}

                          {selectedApplicationId === application.id && (
                            <div className="pt-4 border-t border-white/10 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                  <label className="text-white text-sm font-medium mb-2 block">
                                    Update Status
                                  </label>
                                  <Select value={newStatus} onValueChange={setNewStatus} data-testid="status-select">
                                    <SelectTrigger className="bg-white/5 border-white/20 text-white">
                                      <SelectValue placeholder="Select new status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="reviewed">Reviewed</SelectItem>
                                      <SelectItem value="shortlisted">Shortlisted</SelectItem>
                                      <SelectItem value="rejected">Rejected</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <label className="text-white text-sm font-medium mb-2 block">
                                    Review Notes
                                  </label>
                                  <Textarea
                                    value={reviewNotes}
                                    onChange={(e) => setReviewNotes(e.target.value)}
                                    placeholder="Add your review notes..."
                                    className="bg-white/5 border-white/20 text-white"
                                    data-testid="review-notes"
                                  />
                                </div>
                              </div>
                              <div className="flex space-x-2">
                                <Button
                                  onClick={handleStatusUpdate}
                                  disabled={!newStatus || updateStatusMutation.isPending}
                                  className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8]"
                                >
                                  Save Review
                                </Button>
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedApplicationId(null);
                                    setReviewNotes("");
                                    setNewStatus("");
                                  }}
                                  className="border-white/20 text-white hover:bg-white/10"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Jobs Tab */}
            <TabsContent value="jobs">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <CardTitle className="text-white">My Job Postings</CardTitle>
                  <CardDescription className="text-white/70">
                    Manage your posted job opportunities
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {jobs.length === 0 ? (
                      <div className="text-center py-8">
                        <Briefcase className="h-12 w-12 text-white/30 mx-auto mb-4" />
                        <p className="text-white/70">No job postings yet</p>
                        <Button className="mt-4 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8]">
                          Post Your First Job
                        </Button>
                      </div>
                    ) : (
                      jobs.map((job: any) => (
                        <div
                          key={job.id}
                          className="p-4 rounded-lg bg-white/5 border border-white/10"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <h3 className="text-white font-medium text-lg">{job.title}</h3>
                              <p className="text-white/70">{job.company} • {job.location}</p>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Badge className={getStatusColor(job.status)}>
                                {job.status}
                              </Badge>
                              <span className="text-white/70 text-sm">
                                {job.applicationCount || 0} applications
                              </span>
                            </div>
                          </div>
                          <p className="text-white/60 text-sm mb-3">{job.description}</p>
                          <div className="flex space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Applications
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              Edit Job
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <Footer />
    </div>
  );
}
