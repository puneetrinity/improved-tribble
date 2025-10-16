import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
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
  Target
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { UserProfile, Application, Job } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";

type ApplicationWithJob = Application & { job: Job };

export default function CandidateDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    bio: "",
    skills: [] as string[],
    linkedin: "",
    location: "",
  });
  const [newSkill, setNewSkill] = useState("");
  const [isVisible, setIsVisible] = useState(false);

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not authenticated
  if (!user) {
    return <Redirect to="/auth" />;
  }

  const { data: profile, isLoading: profileLoading } = useQuery<UserProfile | null>({
    queryKey: ["/api/profile"],
    queryFn: async () => {
      const response = await fetch("/api/profile");
      if (!response.ok) throw new Error("Failed to fetch profile");
      return response.json();
    },
  });

  const { data: applications, isLoading: applicationsLoading } = useQuery<ApplicationWithJob[]>({
    queryKey: ["/api/my-applications"],
    queryFn: async () => {
      const response = await fetch("/api/my-applications");
      if (!response.ok) throw new Error("Failed to fetch applications");
      return response.json();
    },
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
      submitted: { color: "bg-blue-500/20 text-blue-300", icon: Clock, label: "Submitted" },
      reviewed: { color: "bg-yellow-500/20 text-yellow-300", icon: Eye, label: "Under Review" },
      shortlisted: { color: "bg-green-500/20 text-green-300", icon: UserCheck, label: "Shortlisted" },
      rejected: { color: "bg-red-500/20 text-red-300", icon: XCircle, label: "Rejected" },
      downloaded: { color: "bg-purple-500/20 text-purple-300", icon: Download, label: "Resume Downloaded" },
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

  const ApplicationCard = ({ application }: { application: ApplicationWithJob }) => (
    <Card className="mb-4 bg-white/10 backdrop-blur-sm border-white/20">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-white text-xl mb-2">{application.job.title}</CardTitle>
            <CardDescription className="text-gray-300">
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
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-gray-300 mb-3 line-clamp-2">{application.job.description}</p>
        
        {application.job.skills && application.job.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {application.job.skills.map((skill, index) => (
              <Badge key={index} variant="outline" className="border-purple-400/30 text-purple-300">
                {skill}
              </Badge>
            ))}
          </div>
        )}

        {application.coverLetter && (
          <div className="mb-3 p-3 bg-white/5 rounded-lg">
            <Label className="text-white font-medium text-sm">Your Cover Letter</Label>
            <p className="text-gray-300 text-sm mt-1">{application.coverLetter}</p>
          </div>
        )}

        {application.notes && (
          <div className="mb-3 p-3 bg-blue-500/10 rounded-lg border-l-4 border-blue-400">
            <Label className="text-blue-400 font-medium text-sm">Recruiter Feedback</Label>
            <p className="text-gray-300 text-sm mt-1">{application.notes}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-gray-400">
            {application.lastViewedAt && (
              <span>Viewed: {formatDate(application.lastViewedAt)}</span>
            )}
            {application.downloadedAt && (
              <span>Resume Downloaded: {formatDate(application.downloadedAt)}</span>
            )}
          </div>
          
          {application.status === 'submitted' && (
            <Button
              onClick={() => handleWithdrawApplication(application.id)}
              variant="outline"
              size="sm"
              className="border-red-400/30 text-red-300 hover:bg-red-500/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Withdraw
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  if (profileLoading || applicationsLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto"></div>
            <p className="text-white mt-4">Loading dashboard...</p>
          </div>
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
                <Target className="h-8 w-8 text-[#7B38FB]" />
                <h1 className="text-4xl md:text-5xl font-bold">
                  <span className="animate-gradient-text">Candidate</span>
                  <span className="text-white ml-3">Dashboard</span>
                </h1>
              </div>
              <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
                Manage your profile and track your job applications with AI-powered insights
              </p>
            </div>

            {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Total Applications</p>
                    <p className="text-3xl font-bold text-blue-400">{stats.total}</p>
                  </div>
                  <Briefcase className="w-8 h-8 text-blue-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">In Progress</p>
                    <p className="text-3xl font-bold text-yellow-400">{stats.pending}</p>
                  </div>
                  <Clock className="w-8 h-8 text-yellow-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Shortlisted</p>
                    <p className="text-3xl font-bold text-green-400">{stats.shortlisted}</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-400" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-300 text-sm">Rejected</p>
                    <p className="text-3xl font-bold text-red-400">{stats.rejected}</p>
                  </div>
                  <XCircle className="w-8 h-8 text-red-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-2 bg-white/10 border-white/20">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="applications">My Applications ({stats.total})</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="mt-6">
              <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-white text-2xl">Profile Information</CardTitle>
                      <CardDescription className="text-gray-300">
                        Manage your profile to auto-fill job applications
                      </CardDescription>
                    </div>
                    {!editingProfile && (
                      <Button onClick={handleEditProfile} variant="outline" className="border-white/20 text-white">
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
                        <Label htmlFor="bio" className="text-white">Bio</Label>
                        <Textarea
                          id="bio"
                          placeholder="Tell us about yourself..."
                          value={profileData.bio}
                          onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        />
                      </div>

                      <div>
                        <Label htmlFor="location" className="text-white">Location</Label>
                        <Input
                          id="location"
                          placeholder="City, Country"
                          value={profileData.location}
                          onChange={(e) => setProfileData({ ...profileData, location: e.target.value })}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        />
                      </div>

                      <div>
                        <Label htmlFor="linkedin" className="text-white">LinkedIn URL</Label>
                        <Input
                          id="linkedin"
                          placeholder="https://linkedin.com/in/yourprofile"
                          value={profileData.linkedin}
                          onChange={(e) => setProfileData({ ...profileData, linkedin: e.target.value })}
                          className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                        />
                      </div>

                      <div>
                        <Label className="text-white">Skills</Label>
                        <div className="flex gap-2 mb-3">
                          <Input
                            placeholder="Add a skill"
                            value={newSkill}
                            onChange={(e) => setNewSkill(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleAddSkill()}
                            className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                          />
                          <Button onClick={handleAddSkill} variant="outline" size="sm">
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {profileData.skills.map((skill, index) => (
                            <Badge key={index} variant="outline" className="border-purple-400/30 text-purple-300">
                              {skill}
                              <button
                                onClick={() => handleRemoveSkill(skill)}
                                className="ml-2 text-red-400 hover:text-red-300"
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
                          className="bg-purple-600 hover:bg-purple-700"
                        >
                          <Save className="w-4 h-4 mr-2" />
                          Save Profile
                        </Button>
                        <Button
                          onClick={() => setEditingProfile(false)}
                          variant="outline"
                          className="border-white/20 text-white"
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
                              <Label className="text-white font-medium">Contact Information</Label>
                              <div className="mt-2 space-y-2">
                                <div className="flex items-center gap-2 text-gray-300">
                                  <Mail className="w-4 h-4" />
                                  <span>{user.username}</span>
                                </div>
                                {profile.location && (
                                  <div className="flex items-center gap-2 text-gray-300">
                                    <MapPin className="w-4 h-4" />
                                    <span>{profile.location}</span>
                                  </div>
                                )}
                                {profile.linkedin && (
                                  <div className="flex items-center gap-2 text-gray-300">
                                    <Linkedin className="w-4 h-4" />
                                    <a
                                      href={profile.linkedin}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-400 hover:text-blue-300"
                                    >
                                      LinkedIn Profile
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>

                            {profile.skills && profile.skills.length > 0 && (
                              <div>
                                <Label className="text-white font-medium">Skills</Label>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {profile.skills.map((skill, index) => (
                                    <Badge key={index} variant="outline" className="border-purple-400/30 text-purple-300">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {profile.bio && (
                            <div>
                              <Label className="text-white font-medium">Bio</Label>
                              <p className="text-gray-300 mt-2">{profile.bio}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-center py-8">
                          <User className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-xl font-semibold text-white mb-2">Complete Your Profile</h3>
                          <p className="text-gray-300 mb-4">
                            Add your information to auto-fill job applications and showcase your skills.
                          </p>
                          <Button onClick={handleEditProfile} className="bg-purple-600 hover:bg-purple-700">
                            Create Profile
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="applications" className="mt-6">
              {applications && applications.length > 0 ? (
                applications.map(application => (
                  <ApplicationCard key={application.id} application={application} />
                ))
              ) : (
                <Card className="bg-white/10 backdrop-blur-sm border-white/20">
                  <CardContent className="p-8 text-center">
                    <Briefcase className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-white mb-2">No Applications Yet</h3>
                    <p className="text-gray-300 mb-4">
                      Start applying to jobs to track your progress here.
                    </p>
                    <Button className="bg-purple-600 hover:bg-purple-700">
                      Browse Jobs
                    </Button>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
          </div>
        </div>
      </div>
    </Layout>
  );
}