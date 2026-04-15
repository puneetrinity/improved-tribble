import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useAIFeatures } from "@/hooks/use-ai-features";
import { useAsyncFitScoring } from "@/hooks/use-async-fit-scoring";
import { Redirect, Link } from "wouter";
import { 
  User, 
  MapPin, 
  Calendar, 
  Eye, 
  Download, 
  Trash2, 
  Edit3, 
  Save, 
  X,
  Plus,
  Briefcase,
  Clock,
  CheckCircle,
  XCircle,
  UserCheck,
  Linkedin,
  Mail,
  Phone,
  Star,
  Target,
  AlertCircle,
  Sparkles,
  Brain,
  Upload,
  Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { UserProfile, Application, Job } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchWithCsrf } from "@/lib/csrf";
import Layout from "@/components/Layout";
import { KpiCard } from "@/components/dashboards/KpiCard";
import { CandidateTimeline } from "@/components/dashboards/CandidateTimeline";
import { ProfileCompletionBanner } from "@/components/ProfileCompletionBanner";
import { candidateDashboardCopy } from "@/lib/internal-copy";

type ApplicationWithJob = Application & {
  job: Job;
  stageName?: string | null;
  stageOrder?: number | null;
};

export default function CandidateDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { fitScoring, resumeAdvisor, queueEnabled } = useAIFeatures();
  const asyncFit = useAsyncFitScoring({ queueEnabled });
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    bio: "",
    skills: [] as string[],
    linkedin: "",
    location: "",
  });
  const [newSkill, setNewSkill] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeLabel, setResumeLabel] = useState("");
  const [resumeIsDefault, setResumeIsDefault] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const MAX_RESUME_SIZE = 5 * 1024 * 1024; // 5MB client-side guard

  // Redirect if not authenticated - candidates go to candidate auth page
  if (!user) {
    return <Redirect to="/candidate-auth" />;
  }

  // API returns { user, profile } structure - extract the profile part
  const { data: profileResponse, isLoading: profileLoading } = useQuery<{ user: any; profile: UserProfile } | null>({
    queryKey: ["/api/profile"],
    queryFn: async () => {
      const response = await fetch("/api/profile");
      if (!response.ok) throw new Error("Failed to fetch profile");
      return response.json();
    },
  });
  const profile = profileResponse?.profile ?? null;

  const { data: applications, isLoading: applicationsLoading } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/my-applications"],
    queryFn: async () => {
      const response = await fetch("/api/my-applications");
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
  });

  const { data: resumes, isLoading: resumesLoading } = useQuery<any[]>({
    queryKey: ["/api/ai/resume"],
    queryFn: async () => {
      const response = await fetch("/api/ai/resume");
      if (!response.ok) throw new Error("Failed to fetch resumes");
      const data = await response.json();
      // Server returns { resumes: [...] }
      return data?.resumes ?? [];
    },
    enabled: resumeAdvisor,
  });

  const { data: aiLimits } = useQuery<any>({
    queryKey: ["/api/ai/limits"],
    queryFn: async () => {
      const response = await fetch("/api/ai/limits");
      if (!response.ok) throw new Error("Failed to fetch AI limits");
      const data = await response.json();
      return data?.limits ?? null;
    },
    enabled: fitScoring,
    refetchInterval: 30_000, // Refresh every 30 seconds
  });

  const updateProfileMutation = useMutation({
    mutationFn: async (data: any) => {
      const method = profile ? "PATCH" : "POST";
      const res = await apiRequest(method, "/api/profile", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/profile"] });
      setEditingProfile(false);
      toast({
        title: "Profile updated",
        description: "Your profile has been updated successfully.",
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

  const withdrawApplicationMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("DELETE", `/api/applications/${applicationId}/withdraw`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
      toast({
        title: "Application withdrawn",
        description: "Your application has been withdrawn successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Withdrawal failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const computeFitMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("POST", "/api/ai/match", { applicationId });
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/limits"] });

      const isCached = data?.fit?.cached === true;
      toast({
        title: isCached ? "Cached fit score" : "Fit score computed",
        description: isCached
          ? "Returned from cache (no quota used)."
          : "AI has analyzed your fit for this position.",
      });
    },
    onError: (error: Error) => {
      // Check if it's a 429 rate limit error
      const is429 = error.message.includes("429");
      toast({
        title: is429 ? "Rate limit exceeded" : "Computation failed",
        description: is429
          ? "Please try again in a minute."
          : error.message,
        variant: "destructive",
      });
    },
  });

  const batchComputeFitMutation = useMutation({
    mutationFn: async (applicationIds: number[]) => {
      const res = await apiRequest("POST", "/api/ai/match/batch", { applicationIds });
      return await res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ai/limits"] });

      const cached = data.summary?.cached || 0;
      const successful = data.summary?.successful || 0;
      toast({
        title: "Batch computation complete",
        description: `Computed: ${successful}, Cached: ${cached}`,
      });
    },
    onError: (error: Error) => {
      const is429 = error.message.includes("429");
      toast({
        title: is429 ? "Rate limit exceeded" : "Batch computation failed",
        description: is429
          ? "Please try again in a minute."
          : error.message,
        variant: "destructive",
      });
    },
  });

  const deleteResumeMutation = useMutation({
    mutationFn: async (resumeId: number) => {
      const res = await apiRequest("DELETE", `/api/ai/resume/${resumeId}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/resume"] });
      toast({
        title: "Resume deleted",
        description: "Resume has been removed from your library.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditProfile = () => {
    setProfileData({
      bio: profile?.bio || "",
      skills: profile?.skills || [],
      linkedin: profile?.linkedin || "",
      location: profile?.location || "",
    });
    setEditingProfile(true);
  };

  const handleSaveProfile = () => {
    updateProfileMutation.mutate(profileData);
  };

  const handleAddSkill = () => {
    if (newSkill.trim() && !profileData.skills.includes(newSkill.trim())) {
      setProfileData({
        ...profileData,
        skills: [...profileData.skills, newSkill.trim()]
      });
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skill: string) => {
    setProfileData({
      ...profileData,
      skills: profileData.skills.filter(s => s !== skill)
    });
  };

  const handleWithdrawApplication = (applicationId: number) => {
    if (confirm("Are you sure you want to withdraw this application? This action cannot be undone.")) {
      withdrawApplicationMutation.mutate(applicationId);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      submitted: { color: "bg-info/20 text-info", icon: Clock, label: "Submitted" },
      reviewed: { color: "bg-warning/20 text-warning", icon: Eye, label: "Under Review" },
      shortlisted: { color: "bg-success/20 text-success", icon: UserCheck, label: "Shortlisted" },
      rejected: { color: "bg-destructive/20 text-destructive", icon: XCircle, label: "Rejected" },
      downloaded: { color: "bg-primary/20 text-primary", icon: Download, label: "Resume Downloaded" },
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.submitted;
    const Icon = config.icon;
    
    return (
      <Badge variant="secondary" className={config.color}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getApplicationStats = () => {
    if (!applications) return { total: 0, pending: 0, shortlisted: 0, rejected: 0 };
    
    return {
      total: applications.length,
      pending: applications.filter(app => ['submitted', 'reviewed', 'downloaded'].includes(app.status)).length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      rejected: applications.filter(app => app.status === 'rejected').length,
    };
  };

  const stats = getApplicationStats();

  // Prepare timeline data
  const timelineApplications = useMemo(() => {
    if (!applications) return [];
    return applications.map(app => ({
      id: app.id,
      jobTitle: app.job.title,
      jobLocation: app.job.location,
      appliedAt: app.appliedAt,
      status: app.status,
      stageName: app.stageName ?? null,
    }));
  }, [applications]);

  const getFitBadge = (score: number | null, label: string | null) => {
    if (score === null || label === null) return null;

    const colorMap: Record<string, string> = {
      'Exceptional': 'bg-success/20 text-success border-success/30',
      'Strong': 'bg-info/20 text-info border-info/30',
      'Good': 'bg-primary/20 text-primary border-primary/30',
      'Partial': 'bg-warning/20 text-warning border-warning/30',
      'Low': 'bg-destructive/20 text-destructive border-destructive/30',
    };

    const colorClass = colorMap[label] || 'bg-muted/20 text-muted-foreground border-muted/30';

    return (
      <Badge variant="outline" className={`${colorClass} font-medium`}>
        <Sparkles className="w-3 h-3 mr-1" />
        {label} ({score})
      </Badge>
    );
  };

  const handleComputeFit = (applicationId: number) => {
    // Use async queue if available, fallback to sync
    if (asyncFit.isQueueAvailable) {
      asyncFit.enqueueInteractive(applicationId);
    } else {
      computeFitMutation.mutate(applicationId);
    }
  };

  const handleBatchComputeFit = () => {
    if (!applications) return;
    // Get all applications without fit scores or with stale scores
    const needsCompute = applications
      .filter(app => !app.aiFitScore || app.aiStaleReason)
      .map(app => app.id);

    if (needsCompute.length === 0) {
      toast({
        title: "No applications to compute",
        description: "All applications have fresh fit scores.",
      });
      return;
    }

    // Use async queue if available, fallback to sync
    if (asyncFit.isQueueAvailable) {
      asyncFit.enqueueBatch(needsCompute);
    } else {
      batchComputeFitMutation.mutate(needsCompute);
    }
  };

  const handleResumeUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeFile || !resumeLabel.trim()) {
      toast({
        title: "Missing information",
        description: "Please provide a label and select a file.",
        variant: "destructive",
      });
      return;
    }

    if (resumes && resumes.length >= 3) {
      toast({
        title: "Maximum resumes reached",
        description: "Please delete an existing resume before adding a new one.",
        variant: "destructive",
      });
      return;
    }

    if (resumeFile && resumeFile.size > MAX_RESUME_SIZE) {
      toast({
        title: "File too large",
        description: "Maximum size is 5MB. Please upload a smaller file.",
        variant: "destructive",
      });
      return;
    }

    setUploadingResume(true);
    try {
      const formData = new FormData();
      formData.append('label', resumeLabel);
      if (resumeIsDefault) formData.append('isDefault', 'true');
      formData.append('resume', resumeFile);

      const response = await fetchWithCsrf('/api/ai/resume', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let serverMsg = '';
        try {
          const error = await response.json();
          serverMsg = error.message || error.error || '';
        } catch {}

        // Friendly mapping
        let friendly = serverMsg;
        if (response.status === 415 || /Unsupported file type/i.test(serverMsg)) {
          friendly = 'Unsupported file type. Only genuine PDF, DOC, or DOCX files are allowed.';
        } else if (/File too large/i.test(serverMsg)) {
          friendly = 'File too large. Maximum size is 5MB.';
        } else if (/must contain at least 50/i.test(serverMsg)) {
          friendly = 'Could not detect enough text. If this is a scanned PDF, please upload a text-based PDF/DOC/DOCX.';
        } else if (/Extraction failed|timeout/i.test(serverMsg)) {
          friendly = 'Resume text extraction failed. If the file is scanned/image-only, convert it to a text-based document and try again.';
        }

        throw new Error(friendly || `${response.status} ${response.statusText}`);
      }

      queryClient.invalidateQueries({ queryKey: ["/api/ai/resume"] });
      toast({
        title: "Resume uploaded",
        description: "Your resume has been added to the library.",
      });

      // Reset form
      setResumeFile(null);
      setResumeLabel("");
      setResumeIsDefault(false);
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload resume",
        variant: "destructive",
      });
    } finally {
      setUploadingResume(false);
    }
  };

  const handleDeleteResume = (resumeId: number) => {
    deleteResumeMutation.mutate(resumeId);
  };

  const ApplicationCard = ({ application }: { application: ApplicationWithJob }) => (
    <Card className="mb-4 border-border">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-foreground text-xl mb-2">{application.job.title}</CardTitle>
            <CardDescription className="text-muted-foreground">
              <div className="flex items-center gap-4 mb-2">
                <span className="flex items-center gap-1">
                  <MapPin className="w-4 h-4" />
                  {application.job.location}
                </span>
                <span className="flex items-center gap-1">
                  <Briefcase className="w-4 h-4" />
                  {application.job.type}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Applied {formatDate(application.appliedAt)}
                </span>
              </div>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(application.status)}
            {getFitBadge(application.aiFitScore, application.aiFitLabel)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-3 line-clamp-2">{application.job.description}</p>

        {/* AI Fit Analysis */}
        {fitScoring && application.aiFitScore !== null && application.aiFitReasons && Array.isArray(application.aiFitReasons) ? (
          <div className="mb-3 p-3 bg-primary/5 rounded-lg border-l-4 border-primary">
            <Label className="text-primary font-medium text-sm flex items-center gap-2">
              <Brain className="w-4 h-4" />
              AI Fit Analysis
            </Label>
            <ul className="text-muted-foreground text-sm mt-2 space-y-1">
              {(application.aiFitReasons as string[]).slice(0, 3).map((reason: string, idx: number): JSX.Element => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
            {application.aiStaleReason && (
              <p className="text-warning text-xs mt-2 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                Score may be outdated ({application.aiStaleReason})
              </p>
            )}
          </div>
        ) : null}
        
        {application.job.skills && application.job.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {application.job.skills.map((skill, index) => (
              <Badge key={index} variant="outline" className="border-primary/30 text-primary">
                {skill}
              </Badge>
            ))}
          </div>
        )}

        {application.coverLetter && (
          <div className="mb-3 p-3 bg-muted/50 rounded-lg">
            <Label className="text-foreground font-medium text-sm">Your Cover Letter</Label>
            <p className="text-muted-foreground text-sm mt-1">{application.coverLetter}</p>
          </div>
        )}

        {application.notes && (
          <div className="mb-3 p-3 bg-info/10 rounded-lg border-l-4 border-info">
            <Label className="text-info font-medium text-sm">Recruiter Feedback</Label>
            <p className="text-muted-foreground text-sm mt-1">{application.notes}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {application.lastViewedAt && (
              <span>Viewed: {formatDate(application.lastViewedAt)}</span>
            )}
            {application.downloadedAt && (
              <span>Resume Downloaded: {formatDate(application.downloadedAt)}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {fitScoring && (!application.aiFitScore || application.aiStaleReason) && (
              <Button
                onClick={() => handleComputeFit(application.id)}
                disabled={computeFitMutation.isPending || asyncFit.isEnqueueingInteractive || asyncFit.isProcessing}
                variant="outline"
                size="sm"
                className="border-primary/30 text-primary hover:bg-primary/10"
              >
                {(computeFitMutation.isPending || asyncFit.isEnqueueingInteractive) ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                {application.aiStaleReason ? 'Recompute' : 'Compute'} Fit
              </Button>
            )}
            {application.status === 'submitted' && (
              <Button
                onClick={() => handleWithdrawApplication(application.id)}
                variant="outline"
                size="sm"
                className="border-destructive/30 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Withdraw
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (profileLoading || applicationsLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="text-foreground mt-4">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <Target className="h-7 w-7 text-primary" />
                <h1 className="text-3xl font-bold text-foreground">
                  {candidateDashboardCopy.header.titlePrimary} {candidateDashboardCopy.header.titleSecondary}
                </h1>
              </div>
              <p className="text-muted-foreground max-w-2xl">
                {candidateDashboardCopy.header.subtitle}
              </p>
            </div>

            {/* Profile Completion Banner */}
            <ProfileCompletionBanner />

            {/* Feature Status Banners */}
            {!fitScoring && (
              <Alert className="mb-6 bg-warning/10 border-warning/30 text-warning">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {candidateDashboardCopy.alerts.fitUnavailable}
                </AlertDescription>
              </Alert>
            )}
            {!resumeAdvisor && (
              <Alert className="mb-6 bg-info/10 border-info/30 text-info">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {candidateDashboardCopy.alerts.resumeUnavailable}
                </AlertDescription>
              </Alert>
            )}

            {/* AI Limits Display */}
            {fitScoring && aiLimits && (
              <Card className="mb-6 border-border">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/20 rounded-lg">
                        <Sparkles className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="text-foreground font-medium">{candidateDashboardCopy.alerts.fitComputations}</h3>
                        <p className="text-muted-foreground text-sm">
                          {aiLimits.fitRemainingThisMonth} of {aiLimits.fitLimitPerMonth} remaining this month
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">
                        {aiLimits.fitRemainingThisMonth}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Used: {aiLimits.fitUsedThisMonth}
                      </div>
                    </div>
                  </div>
                  {aiLimits.fitRemainingThisMonth === 0 && (
                    <div className="mt-3 p-2 bg-warning/10 rounded border-l-4 border-warning">
                      <p className="text-warning text-sm">
                        You've used all free computations this month. Cached results are still available.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8" data-tour="my-applications">
            <KpiCard
              label="Total Applications"
              value={stats.total}
              icon={Briefcase}
              isLoading={applicationsLoading}
            />
            <KpiCard
              label="In Progress"
              value={stats.pending}
              icon={Clock}
              isLoading={applicationsLoading}
            />
            <KpiCard
              label="Shortlisted"
              value={stats.shortlisted}
              icon={CheckCircle}
              isLoading={applicationsLoading}
            />
            <KpiCard
              label="Rejected"
              value={stats.rejected}
              icon={XCircle}
              isLoading={applicationsLoading}
            />
          </div>

          {/* Timeline */}
          <div className="mb-8">
            <CandidateTimeline
              title="Application Timeline"
              description="Your applications grouped by month"
              applications={timelineApplications}
              isLoading={applicationsLoading}
            />
          </div>

          {/* Main Content */}
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="applications">My Applications ({stats.total})</TabsTrigger>
              <TabsTrigger value="resumes">Resume Library</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-6" data-tour="profile-settings">
              <Card className="border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-foreground text-2xl">Profile Information</CardTitle>
                      <CardDescription className="text-muted-foreground">
                        Manage your profile to auto-fill job applications
                      </CardDescription>
                    </div>
                    {!editingProfile && (
                      <Button onClick={handleEditProfile} variant="outline" className="border-border text-foreground">
                        <Edit3 className="w-4 h-4 mr-2" />
                        Edit Profile
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {editingProfile ? (
                    <div className="space-y-6">
                      <div>
                        <Label htmlFor="bio" className="text-foreground">Bio</Label>
                        <Textarea
                          id="bio"
                          placeholder="Tell us about yourself..."
                          value={profileData.bio}
                          onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
                          className="border-border text-foreground"
                        />
                      </div>

                      <div>
                        <Label htmlFor="location" className="text-foreground">Location</Label>
                        <Input
                          id="location"
                          placeholder="City, Country"
                          value={profileData.location}
                          onChange={(e) => setProfileData({ ...profileData, location: e.target.value })}
                          className="border-border text-foreground"
                        />
                      </div>

                      <div>
                        <Label htmlFor="linkedin" className="text-foreground">LinkedIn URL</Label>
                        <Input
                          id="linkedin"
                          placeholder="https://linkedin.com/in/yourprofile"
                          value={profileData.linkedin}
                          onChange={(e) => setProfileData({ ...profileData, linkedin: e.target.value })}
                          className="border-border text-foreground"
                        />
                      </div>

                      <div>
                        <Label className="text-foreground">Skills</Label>
                        <div className="flex gap-2 mb-3">
                          <Input
                            placeholder="Add a skill"
                            value={newSkill}
                            onChange={(e) => setNewSkill(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddSkill()}
                            className="border-border text-foreground"
                          />
                          <Button onClick={handleAddSkill} variant="outline" size="sm">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {profileData.skills.map((skill, index) => (
                            <Badge key={index} variant="outline" className="border-primary/30 text-primary">
                              {skill}
                              <button
                                onClick={() => handleRemoveSkill(skill)}
                                className="ml-2 text-destructive hover:text-destructive"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <Button
                          onClick={handleSaveProfile}
                          disabled={updateProfileMutation.isPending}
                          className="bg-primary hover:bg-primary/80"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          Save Profile
                        </Button>
                        <Button
                          onClick={() => setEditingProfile(false)}
                          variant="outline"
                          className="border-border text-foreground"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {profile ? (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <Label className="text-foreground font-medium">Contact Information</Label>
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <Mail className="w-4 h-4" />
                                  <span>{user.username}</span>
                                </div>
                                {profile.location && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <MapPin className="w-4 h-4" />
                                    <span>{profile.location}</span>
                                  </div>
                                )}
                                {profile.linkedin && (
                                  <div className="flex items-center gap-2 text-muted-foreground">
                                    <Linkedin className="w-4 h-4" />
                                    <a
                                      href={profile.linkedin}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-info hover:text-info"
                                    >
                                      LinkedIn Profile
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>

                            {profile.skills && profile.skills.length > 0 && (
                              <div>
                                <Label className="text-foreground font-medium">Skills</Label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {profile.skills.map((skill, index) => (
                                    <Badge key={index} variant="outline" className="border-primary/30 text-primary">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {profile.bio && (
                            <div>
                              <Label className="text-foreground font-medium">Bio</Label>
                              <p className="text-muted-foreground mt-2">{profile.bio}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <User className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                          <h3 className="text-xl font-semibold text-foreground mb-2">Complete Your Profile</h3>
                          <p className="text-muted-foreground mb-4">
                            Add your information to auto-fill job applications and showcase your skills.
                          </p>
                          <Button onClick={handleEditProfile} className="bg-primary hover:bg-primary/80">
                            Create Profile
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="applications" className="mt-6" data-tour="application-status">
              {fitScoring && applications && applications.length > 0 && (
                <div className="mb-4 border border-border rounded-lg p-4">
                  {asyncFit.isProcessing ? (
                    // Show progress when async job is active
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-foreground font-medium flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            Analyzing Applications
                          </h3>
                          <p className="text-muted-foreground text-sm">
                            {asyncFit.processedCount} of {asyncFit.totalCount} processed
                          </p>
                        </div>
                        <Button
                          onClick={() => asyncFit.activeJobId && asyncFit.cancelJob(asyncFit.activeJobId)}
                          disabled={asyncFit.isCancelling}
                          variant="outline"
                          size="sm"
                        >
                          {asyncFit.isCancelling ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                          Cancel
                        </Button>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-300"
                          style={{ width: `${asyncFit.progress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    // Show compute button when idle
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-foreground font-medium">AI Fit Scoring</h3>
                        <p className="text-muted-foreground text-sm">
                          Compute fit scores for all applications
                        </p>
                      </div>
                      <Button
                        onClick={handleBatchComputeFit}
                        disabled={batchComputeFitMutation.isPending || asyncFit.isEnqueueingBatch}
                        className="bg-primary hover:bg-primary/80"
                      >
                        {(batchComputeFitMutation.isPending || asyncFit.isEnqueueingBatch) ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4 mr-2" />
                        )}
                        Compute All Fits
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {applications && applications.length > 0 ? (
                applications.map(application => (
                  <ApplicationCard key={application.id} application={application} />
                ))
              ) : (
                <Card className="border-border">
                  <CardContent className="p-8 text-center">
                    <Briefcase className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">No Applications Yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Start applying to jobs to track your progress here.
                    </p>
                    <Link href="/jobs">
                      <Button className="bg-primary hover:bg-primary/80">
                        Browse Jobs
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="resumes" className="mt-6">
              {/* Upload Resume Section */}
              <Card className="border-border mb-6">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <Upload className="w-5 h-5" />
                    Upload Resume
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Add a resume to your library (max 3). PDF or DOCX format.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleResumeUpload} className="space-y-4">
                    <div>
                      <Label className="text-foreground">Resume Label *</Label>
                      <Input
                        value={resumeLabel}
                        onChange={(e) => setResumeLabel(e.target.value)}
                        placeholder="e.g., Software Engineer Resume"
                        className="border-border text-foreground"
                        required
                      />
                    </div>

                    <div>
                      <Label className="text-foreground">Resume File * (PDF or DOCX)</Label>
                      <Input
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                        className="border-border text-foreground"
                        required
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="is-default"
                        checked={resumeIsDefault}
                        onChange={(e) => setResumeIsDefault(e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor="is-default" className="text-foreground cursor-pointer">
                        Set as default resume
                      </Label>
                    </div>

                    <Button
                      type="submit"
                      disabled={uploadingResume || !resumeFile || !resumeLabel.trim() || (resumes && resumes.length >= 3)}
                      className="bg-primary hover:bg-primary/80"
                    >
                      {uploadingResume ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Upload Resume
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* Resume List */}
              <Card className="border-border">
                <CardHeader>
                  <CardTitle className="text-foreground">Your Resumes ({resumes?.length || 0}/3)</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    Manage your resume library
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {resumesLoading ? (
                    <div className="text-center py-8">
                      <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
                      <p className="text-muted-foreground mt-2">Loading resumes...</p>
                    </div>
                  ) : resumes && resumes.length > 0 ? (
                    <div className="space-y-3">
                      {resumes.map((resume) => (
                        <div
                          key={resume.id}
                          className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border border-border"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-foreground font-medium">{resume.label}</h4>
                              {resume.isDefault && (
                                <Badge variant="outline" className="border-success/30 text-success">
                                  <Star className="w-3 h-3 mr-1 fill-green-300" />
                                  Default
                                </Badge>
                              )}
                            </div>
                            <p className="text-muted-foreground text-sm mt-1">
                              Uploaded {new Date(resume.createdAt).toLocaleDateString()}
                              {resume.updatedAt !== resume.createdAt &&
                                ` • Updated ${new Date(resume.updatedAt).toLocaleDateString()}`
                              }
                            </p>
                          </div>
                          <Button
                            onClick={() => handleDeleteResume(resume.id)}
                            disabled={deleteResumeMutation.isPending}
                            variant="outline"
                            size="sm"
                            className="border-destructive/30 text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Upload className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-foreground mb-2">No Resumes Yet</h3>
                      <p className="text-muted-foreground">
                        Upload your first resume to use AI-powered fit scoring.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
}
