import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import {
  MapPin,
  Clock,
  Calendar,
  Users,
  FileText,
  Download,
  Eye,
  CheckCircle,
  XCircle,
  UserCheck,
  MessageSquare,
  Filter,
  Search,
  Briefcase,
  Target,
  Mail,
  Star,
  History
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Job, Application, PipelineStage, EmailTemplate } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function ApplicationManagementPage() {
  const [match, params] = useRoute("/jobs/:id/applications");
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedApplications, setSelectedApplications] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkNotes, setBulkNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTab, setSelectedTab] = useState("all");
  const [isVisible, setIsVisible] = useState(false);

  // ATS features state
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewTime, setInterviewTime] = useState("");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [newRecruiterNote, setNewRecruiterNote] = useState("");
  const [showInterviewDialog, setShowInterviewDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showHistoryDialog, setShowHistoryDialog] = useState(false);

  const jobId = params?.id ? parseInt(params.id) : null;

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not recruiter or admin
  if (!user || !['recruiter', 'admin'].includes(user.role)) {
    return <Redirect to="/auth" />;
  }

  const { data: job, isLoading: jobLoading } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: applications, isLoading: applicationsLoading } = useQuery<Application[]>({
    queryKey: ["/api/jobs", jobId, "applications"],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}/applications`);
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
    enabled: !!jobId,
  });

  // ATS: Fetch pipeline stages
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
    queryFn: async () => {
      const response = await fetch("/api/pipeline/stages");
      if (!response.ok) throw new Error("Failed to fetch pipeline stages");
      return response.json();
    },
  });

  // ATS: Fetch email templates
  const { data: emailTemplates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
    queryFn: async () => {
      const response = await fetch("/api/email-templates");
      if (!response.ok) throw new Error("Failed to fetch email templates");
      return response.json();
    },
  });

  // ATS: Fetch stage history for selected application
  const { data: stageHistory = [] } = useQuery({
    queryKey: ["/api/applications", selectedApp?.id, "history"],
    queryFn: async () => {
      const response = await fetch(`/api/applications/${selectedApp?.id}/history`);
      if (!response.ok) throw new Error("Failed to fetch stage history");
      return response.json();
    },
    enabled: !!selectedApp?.id && showHistoryDialog,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ applicationId, status, notes }: { applicationId: number; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/status`, {
        status,
        notes
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: "Status updated",
        description: "Application status has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ applicationIds, status, notes }: { applicationIds: number[]; status: string; notes?: string }) => {
      const res = await apiRequest("PATCH", "/api/applications/bulk", {
        applicationIds,
        status,
        notes
      });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setSelectedApplications([]);
      setBulkStatus("");
      setBulkNotes("");
      toast({
        title: "Bulk update successful",
        description: `${data.updatedCount} applications updated successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Bulk update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const markViewedMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/view`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
    },
  });

  const markDownloadedMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/download`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: "Download tracked",
        description: "Resume download has been recorded.",
      });
    },
  });

  // ATS: Update application stage mutation
  const updateStageMutation = useMutation({
    mutationFn: async ({ applicationId, stageId, notes }: { applicationId: number; stageId: number; notes?: string }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/stage`, {
        stageId,
        notes,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: "Stage updated",
        description: "Application moved to new stage successfully.",
      });
    },
  });

  // ATS: Schedule interview mutation
  const scheduleInterviewMutation = useMutation({
    mutationFn: async ({ applicationId, date, time, location, notes }: {
      applicationId: number;
      date: string;
      time: string;
      location: string;
      notes?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/interview`, {
        date,
        time,
        location,
        notes,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setShowInterviewDialog(false);
      setInterviewDate("");
      setInterviewTime("");
      setInterviewLocation("");
      setInterviewNotes("");
      toast({
        title: "Interview scheduled",
        description: "Interview has been scheduled successfully.",
      });
    },
  });

  // ATS: Send email mutation
  const sendEmailMutation = useMutation({
    mutationFn: async ({ applicationId, templateId }: { applicationId: number; templateId: number }) => {
      const res = await apiRequest("POST", `/api/applications/${applicationId}/send-email`, {
        templateId,
      });
      return await res.json();
    },
    onSuccess: () => {
      setShowEmailDialog(false);
      setSelectedTemplateId(null);
      toast({
        title: "Email sent",
        description: "Email has been sent successfully.",
      });
    },
  });

  // ATS: Add recruiter note mutation
  const addNoteMutation = useMutation({
    mutationFn: async ({ applicationId, note }: { applicationId: number; note: string }) => {
      const res = await apiRequest("POST", `/api/applications/${applicationId}/notes`, {
        note,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      setNewRecruiterNote("");
      toast({
        title: "Note added",
        description: "Recruiter note has been added successfully.",
      });
    },
  });

  // ATS: Set rating mutation
  const setRatingMutation = useMutation({
    mutationFn: async ({ applicationId, rating }: { applicationId: number; rating: number }) => {
      const res = await apiRequest("PATCH", `/api/applications/${applicationId}/rating`, {
        rating,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: "Rating updated",
        description: "Candidate rating has been updated successfully.",
      });
    },
  });

  const handleStatusUpdate = (applicationId: number, status: string, notes?: string) => {
    updateStatusMutation.mutate({ applicationId, status, notes });
  };

  const handleBulkUpdate = () => {
    if (selectedApplications.length === 0 || !bulkStatus) {
      toast({
        title: "Invalid selection",
        description: "Please select applications and a status.",
        variant: "destructive",
      });
      return;
    }
    bulkUpdateMutation.mutate({ 
      applicationIds: selectedApplications, 
      status: bulkStatus, 
      notes: bulkNotes 
    });
  };

  const handleResumeDownload = (application: Application) => {
    // Open resume in new tab
    window.open(application.resumeUrl, '_blank');
    // Track download
    markDownloadedMutation.mutate(application.id);
  };

  const handleApplicationView = (applicationId: number) => {
    markViewedMutation.mutate(applicationId);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      submitted: { color: "bg-blue-500/20 text-blue-300", icon: Clock },
      reviewed: { color: "bg-yellow-500/20 text-yellow-300", icon: Eye },
      shortlisted: { color: "bg-green-500/20 text-green-300", icon: UserCheck },
      rejected: { color: "bg-red-500/20 text-red-300", icon: XCircle },
      downloaded: { color: "bg-purple-500/20 text-purple-300", icon: Download },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.submitted;
    const Icon = config.icon;
    
    return (
      <Badge variant="secondary" className={config.color}>
        <Icon className="w-3 h-3 mr-1" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredApplications = applications?.filter(app => {
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
    const matchesSearch = searchQuery === '' || 
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  }) || [];

  const getApplicationsByStatus = (status: string) => {
    return applications?.filter(app => app.status === status) || [];
  };

  const ApplicationCard = ({ application }: { application: Application }) => {
    const currentStage = pipelineStages.find(s => s.id === application.currentStage);

    return (
      <Card className="mb-4 bg-white/10 backdrop-blur-sm border-white/20">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Checkbox
                checked={selectedApplications.includes(application.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedApplications([...selectedApplications, application.id]);
                  } else {
                    setSelectedApplications(selectedApplications.filter(id => id !== application.id));
                  }
                }}
              />
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-white text-lg">{application.name}</CardTitle>
                  {application.rating && (
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`w-4 h-4 ${star <= application.rating! ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <CardDescription className="text-gray-300">
                  <div className="flex items-center gap-4 mt-1">
                    <span>{application.email}</span>
                    <span>{application.phone}</span>
                    <span>Applied {formatDate(application.appliedAt)}</span>
                  </div>
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentStage && currentStage.color && (
                <Badge
                  style={{
                    backgroundColor: `${currentStage.color}20`,
                    borderColor: currentStage.color,
                    color: currentStage.color
                  }}
                  className="border"
                >
                  {currentStage.name}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {application.coverLetter && (
            <div className="p-3 bg-white/5 rounded-lg">
              <Label className="text-white font-medium">Cover Letter</Label>
              <p className="text-gray-300 text-sm mt-1">{application.coverLetter}</p>
            </div>
          )}

          {application.recruiterNotes && application.recruiterNotes.length > 0 && (
            <div className="p-3 bg-purple-500/10 rounded-lg border-l-4 border-purple-400">
              <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-purple-400" />
                <Label className="text-purple-400 font-medium">Recruiter Notes</Label>
              </div>
              <div className="space-y-1">
                {application.recruiterNotes.map((note, idx) => (
                  <p key={idx} className="text-gray-300 text-sm">• {note}</p>
                ))}
              </div>
            </div>
          )}

          {application.interviewDate && (
            <div className="p-3 bg-green-500/10 rounded-lg border-l-4 border-green-400">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-green-400" />
                <Label className="text-green-400 font-medium">Interview Scheduled</Label>
              </div>
              <p className="text-gray-300 text-sm">
                {formatDate(application.interviewDate)}
                {application.interviewTime && ` at ${application.interviewTime}`}
              </p>
              {application.interviewLocation && (
                <p className="text-gray-300 text-sm">📍 {application.interviewLocation}</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => handleResumeDownload(application)}
              variant="outline"
              size="sm"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <Download className="w-4 h-4 mr-2" />
              Resume
            </Button>

            <Select
              value={application.currentStage?.toString() || ""}
              onValueChange={(stageId) =>
                updateStageMutation.mutate({ applicationId: application.id, stageId: parseInt(stageId) })
              }
            >
              <SelectTrigger className="w-48 bg-white/5 border-white/20 text-white">
                <SelectValue placeholder="Move to stage..." />
              </SelectTrigger>
              <SelectContent>
                {pipelineStages.map(stage => (
                  <SelectItem key={stage.id} value={stage.id.toString()}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              onClick={() => {
                setSelectedApp(application);
                setShowInterviewDialog(true);
              }}
              variant="outline"
              size="sm"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Interview
            </Button>

            <Button
              onClick={() => {
                setSelectedApp(application);
                setShowEmailDialog(true);
              }}
              variant="outline"
              size="sm"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <Mail className="w-4 h-4 mr-2" />
              Send Email
            </Button>

            <Button
              onClick={() => {
                setSelectedApp(application);
                setShowHistoryDialog(true);
              }}
              variant="outline"
              size="sm"
              className="border-white/20 text-white hover:bg-white/10"
            >
              <History className="w-4 h-4 mr-2" />
              History
            </Button>

            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRatingMutation.mutate({ applicationId: application.id, rating: star })}
                  className="focus:outline-none"
                >
                  <Star
                    className={`w-5 h-5 cursor-pointer transition-colors ${
                      star <= (application.rating || 0)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-gray-400 hover:text-yellow-300'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  if (jobLoading || applicationsLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto"></div>
            <p className="text-white mt-4">Loading applications...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!job) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card className="bg-white/10 backdrop-blur-sm border-white/20">
            <CardContent className="p-8 text-center">
              <h3 className="text-xl font-semibold text-white mb-2">Job Not Found</h3>
              <p className="text-gray-300">The requested job could not be found.</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
        
        <div className={`container mx-auto px-4 py-8 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="max-w-6xl mx-auto">
            {/* Premium Header */}
            <div className="mb-12 pt-16">
              <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mb-6 animate-slide-right"></div>
              <div className="flex items-center gap-3 mb-4">
                <Users className="h-8 w-8 text-[#7B38FB]" />
                <h1 className="text-4xl md:text-5xl font-bold">
                  <span className="animate-gradient-text">Application</span>
                  <span className="text-white ml-3">Management</span>
                </h1>
              </div>
              <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
                Review and manage applications for "{job.title}"
              </p>
            </div>

            {/* Job Header */}
            <Card className="mb-6 bg-white/10 backdrop-blur-sm border-white/20 premium-card animate-slide-up" style={{ animationDelay: '0.5s' }}>
              <CardHeader>
              <CardTitle className="text-white text-2xl">{job.title}</CardTitle>
              <CardDescription className="text-gray-300">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {job.location}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    Posted {formatDate(job.createdAt)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {applications?.length || 0} Applications
                  </span>
                </div>
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Bulk Actions */}
          {selectedApplications.length > 0 && (
            <Card className="mb-6 bg-purple-500/10 backdrop-blur-sm border-purple-400/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <span className="text-white">
                    {selectedApplications.length} application(s) selected
                  </span>
                  <Select value={bulkStatus} onValueChange={setBulkStatus}>
                    <SelectTrigger className="w-40 bg-white/5 border-white/20 text-white">
                      <SelectValue placeholder="Set Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="shortlisted">Shortlisted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Add notes (optional)"
                    value={bulkNotes}
                    onChange={(e) => setBulkNotes(e.target.value)}
                    className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                  />
                  <Button
                    onClick={handleBulkUpdate}
                    disabled={bulkUpdateMutation.isPending}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    Update Selected
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters and Search */}
          <Card className="mb-6 bg-white/10 backdrop-blur-sm border-white/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-40 bg-white/5 border-white/20 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="shortlisted">Shortlisted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="downloaded">Downloaded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Application Tabs */}
          <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
            <TabsList className="grid w-full grid-cols-6 bg-white/10 border-white/20">
              <TabsTrigger value="all">All ({applications?.length || 0})</TabsTrigger>
              <TabsTrigger value="submitted">Submitted ({getApplicationsByStatus('submitted').length})</TabsTrigger>
              <TabsTrigger value="reviewed">Reviewed ({getApplicationsByStatus('reviewed').length})</TabsTrigger>
              <TabsTrigger value="shortlisted">Shortlisted ({getApplicationsByStatus('shortlisted').length})</TabsTrigger>
              <TabsTrigger value="rejected">Rejected ({getApplicationsByStatus('rejected').length})</TabsTrigger>
              <TabsTrigger value="downloaded">Downloaded ({getApplicationsByStatus('downloaded').length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6">
              {filteredApplications.length === 0 ? (
                <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                  <CardContent className="p-8 text-center">
                    <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-white mb-2">No Applications</h3>
                    <p className="text-gray-300">No applications found matching your criteria.</p>
                  </CardContent>
                </Card>
              ) : (
                filteredApplications.map(application => (
                  <ApplicationCard key={application.id} application={application} />
                ))
              )}
            </TabsContent>

            {['submitted', 'reviewed', 'shortlisted', 'rejected', 'downloaded'].map(status => (
              <TabsContent key={status} value={status} className="mt-6">
                {getApplicationsByStatus(status).length === 0 ? (
                  <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                    <CardContent className="p-8 text-center">
                      <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-white mb-2">No {status} Applications</h3>
                      <p className="text-gray-300">No applications with {status} status.</p>
                    </CardContent>
                  </Card>
                ) : (
                  getApplicationsByStatus(status).map(application => (
                    <ApplicationCard key={application.id} application={application} />
                  ))
                )}
              </TabsContent>
            ))}
          </Tabs>
          </div>
        </div>

        {/* ATS Dialogs */}

        {/* Interview Scheduling Dialog */}
        <Dialog open={showInterviewDialog} onOpenChange={setShowInterviewDialog}>
          <DialogContent className="bg-slate-900 border-white/20 text-white">
            <DialogHeader>
              <DialogTitle>Schedule Interview - {selectedApp?.name}</DialogTitle>
              <DialogDescription className="text-gray-400">
                Set interview details for this candidate
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>Date</Label>
                <Input
                  type="datetime-local"
                  value={interviewDate}
                  onChange={(e) => setInterviewDate(e.target.value)}
                  className="bg-white/5 border-white/20 text-white"
                />
              </div>
              <div>
                <Label>Time</Label>
                <Input
                  type="text"
                  placeholder="e.g., 10:00 AM - 11:00 AM"
                  value={interviewTime}
                  onChange={(e) => setInterviewTime(e.target.value)}
                  className="bg-white/5 border-white/20 text-white"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  type="text"
                  placeholder="e.g., Zoom link or office address"
                  value={interviewLocation}
                  onChange={(e) => setInterviewLocation(e.target.value)}
                  className="bg-white/5 border-white/20 text-white"
                />
              </div>
              <div>
                <Label>Notes (Optional)</Label>
                <Textarea
                  placeholder="Additional notes..."
                  value={interviewNotes}
                  onChange={(e) => setInterviewNotes(e.target.value)}
                  className="bg-white/5 border-white/20 text-white"
                />
              </div>
              <Button
                onClick={() =>
                  selectedApp &&
                  scheduleInterviewMutation.mutate({
                    applicationId: selectedApp.id,
                    date: interviewDate,
                    time: interviewTime,
                    location: interviewLocation,
                    notes: interviewNotes,
                  })
                }
                disabled={!interviewDate || !interviewTime || !interviewLocation || scheduleInterviewMutation.isPending}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {scheduleInterviewMutation.isPending ? "Scheduling..." : "Schedule Interview"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Email Sending Dialog */}
        <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
          <DialogContent className="bg-slate-900 border-white/20 text-white">
            <DialogHeader>
              <DialogTitle>Send Email - {selectedApp?.name}</DialogTitle>
              <DialogDescription className="text-gray-400">
                Select a template to send to this candidate
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div>
                <Label>Email Template</Label>
                <Select
                  value={selectedTemplateId?.toString() || ""}
                  onValueChange={(value) => setSelectedTemplateId(parseInt(value))}
                >
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue placeholder="Select template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {emailTemplates.map(template => (
                      <SelectItem key={template.id} value={template.id.toString()}>
                        {template.name} - {template.subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTemplateId && (
                <div className="p-3 bg-white/5 rounded-lg">
                  <Label className="text-sm text-gray-400">Preview</Label>
                  <p className="text-sm text-white mt-1">
                    {emailTemplates.find(t => t.id === selectedTemplateId)?.body.substring(0, 200)}...
                  </p>
                </div>
              )}
              <Button
                onClick={() =>
                  selectedApp &&
                  selectedTemplateId &&
                  sendEmailMutation.mutate({
                    applicationId: selectedApp.id,
                    templateId: selectedTemplateId,
                  })
                }
                disabled={!selectedTemplateId || sendEmailMutation.isPending}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {sendEmailMutation.isPending ? "Sending..." : "Send Email"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Stage History Dialog */}
        <Dialog open={showHistoryDialog} onOpenChange={setShowHistoryDialog}>
          <DialogContent className="bg-slate-900 border-white/20 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle>Stage History - {selectedApp?.name}</DialogTitle>
              <DialogDescription className="text-gray-400">
                Timeline of all stage changes for this application
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-4 max-h-96 overflow-y-auto">
              {stageHistory.length === 0 ? (
                <p className="text-gray-400 text-center py-8">No stage history available</p>
              ) : (
                stageHistory.map((history: any, idx: number) => {
                  const fromStage = pipelineStages.find(s => s.id === history.fromStage);
                  const toStage = pipelineStages.find(s => s.id === history.toStage);

                  return (
                    <div key={idx} className="flex gap-4 p-3 bg-white/5 rounded-lg">
                      <div className="flex-shrink-0">
                        <div
                          className="w-3 h-3 rounded-full mt-1"
                          style={{ backgroundColor: toStage?.color || '#6b7280' }}
                        />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {fromStage && fromStage.color && (
                            <Badge
                              style={{
                                backgroundColor: `${fromStage.color}20`,
                                borderColor: fromStage.color,
                                color: fromStage.color
                              }}
                              className="border text-xs"
                            >
                              {fromStage.name}
                            </Badge>
                          )}
                          <span className="text-gray-400">→</span>
                          {toStage && toStage.color && (
                            <Badge
                              style={{
                                backgroundColor: `${toStage.color}20`,
                                borderColor: toStage.color,
                                color: toStage.color
                              }}
                              className="border text-xs"
                            >
                              {toStage.name}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {formatDate(history.changedAt)}
                        </p>
                        {history.notes && (
                          <p className="text-sm text-gray-300 mt-1">{history.notes}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}