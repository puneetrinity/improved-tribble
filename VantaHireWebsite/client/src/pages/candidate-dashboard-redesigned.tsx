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
import { Job, Application, UserProfile } from "@shared/schema";
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
        title: "Profile updated successfully",
        description: "Your profile information has been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update profile",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const withdrawApplicationMutation = useMutation({
    mutationFn: async (applicationId: number) => {
      const res = await apiRequest("DELETE", `/api/applications/${applicationId}/withdraw`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-applications"] });
      toast({
        title: "Application withdrawn",
        description: "Your application has been successfully withdrawn.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to withdraw application",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditProfile = () => {
    if (profile) {
      setProfileData({
        bio: profile.bio || "",
        skills: profile.skills || [],
        linkedin: profile.linkedin || "",
        location: profile.location || "",
      });
    }
    setEditingProfile(true);
  };

  const handleSaveProfile = () => {
    updateProfileMutation.mutate(profileData);
  };

  const handleAddSkill = () => {
    if (newSkill.trim() && !profileData.skills.includes(newSkill.trim())) {
      setProfileData({
        ...profileData,
        skills: [...profileData.skills, newSkill.trim()],
      });
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setProfileData({
      ...profileData,
      skills: profileData.skills.filter(skill => skill !== skillToRemove),
    });
  };

  const formatDate = (dateString: string | Date) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-400/20 text-yellow-300 border-yellow-400/30">Pending</Badge>;
      case 'reviewing':
        return <Badge className="bg-blue-400/20 text-blue-300 border-blue-400/30">Under Review</Badge>;
      case 'shortlisted':
        return <Badge className="bg-green-400/20 text-green-300 border-green-400/30">Shortlisted</Badge>;
      case 'rejected':
        return <Badge className="bg-red-400/20 text-red-300 border-red-400/30">Rejected</Badge>;
      default:
        return <Badge variant="outline" className="border-white/20 text-white/70">Unknown</Badge>;
    }
  };

  const getApplicationStats = () => {
    if (!applications) return { total: 0, pending: 0, shortlisted: 0, rejected: 0 };
    
    return {
      total: applications.length,
      pending: applications.filter(app => ['pending', 'reviewing'].includes(app.status)).length,
      shortlisted: applications.filter(app => app.status === 'shortlisted').length,
      rejected: applications.filter(app => app.status === 'rejected').length,
    };
  };

  const stats = getApplicationStats();

  const ApplicationCard = ({ application }: { application: ApplicationWithJob }) => (
    <Card className="mb-4 bg-white/10 backdrop-blur-sm border-white/20 premium-card">
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

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {application.resumeUrl && (
              <Button 
                size="sm" 
                variant="outline" 
                className="border-white/20 text-white hover:bg-white/10"
                onClick={() => window.open(application.resumeUrl, '_blank')}
              >
                <Download className="w-4 h-4 mr-1" />
                View Resume
              </Button>
            )}
          </div>
          
          {application.status === 'pending' && (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => withdrawApplicationMutation.mutate(application.id)}
              disabled={withdrawApplicationMutation.isPending}
            >
              <Trash2 className="w-4 h-4 mr-1" />
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
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white/70">Loading your dashboard...</p>
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
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card group animate-slide-up" style={{ animationDelay: '0.5s' }}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-sm">Total Applications</p>
                      <p className="text-3xl font-bold text-white group-hover:tracking-wide transition-all duration-300">{stats.total}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-[#2D81FF]/20 group-hover:scale-110 transition-transform duration-300">
                      <Briefcase className="w-6 h-6 text-[#2D81FF]" />
                    </div>
                  </div>
                  <div className="h-1 w-full bg-gradient-to-r from-[#2D81FF] to-[#7B38FB] rounded-full mt-4 opacity-60 group-hover:opacity-100 transition-opacity"></div>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card group animate-slide-up" style={{ animationDelay: '0.6s' }}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-sm">In Progress</p>
                      <p className="text-3xl font-bold text-white group-hover:tracking-wide transition-all duration-300">{stats.pending}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-yellow-400/20 group-hover:scale-110 transition-transform duration-300">
                      <Clock className="w-6 h-6 text-yellow-400" />
                    </div>
                  </div>
                  <div className="h-1 w-full bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full mt-4 opacity-60 group-hover:opacity-100 transition-opacity"></div>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card group animate-slide-up" style={{ animationDelay: '0.7s' }}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-sm">Shortlisted</p>
                      <p className="text-3xl font-bold text-white group-hover:tracking-wide transition-all duration-300">{stats.shortlisted}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-green-400/20 group-hover:scale-110 transition-transform duration-300">
                      <CheckCircle className="w-6 h-6 text-green-400" />
                    </div>
                  </div>
                  <div className="h-1 w-full bg-gradient-to-r from-green-400 to-emerald-500 rounded-full mt-4 opacity-60 group-hover:opacity-100 transition-opacity"></div>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card group animate-slide-up" style={{ animationDelay: '0.8s' }}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/70 text-sm">Rejected</p>
                      <p className="text-3xl font-bold text-white group-hover:tracking-wide transition-all duration-300">{stats.rejected}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-red-400/20 group-hover:scale-110 transition-transform duration-300">
                      <XCircle className="w-6 h-6 text-red-400" />
                    </div>
                  </div>
                  <div className="h-1 w-full bg-gradient-to-r from-red-400 to-pink-500 rounded-full mt-4 opacity-60 group-hover:opacity-100 transition-opacity"></div>
                </CardContent>
              </Card>
            </div>

            {/* Main Content */}
            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-white/10 backdrop-blur-sm border-white/20">
                <TabsTrigger 
                  value="profile" 
                  className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#7B38FB] data-[state=active]:to-[#FF5BA8] data-[state=active]:text-white text-white/70"
                >
                  <User className="w-4 h-4 mr-2" />
                  Profile
                </TabsTrigger>
                <TabsTrigger 
                  value="applications" 
                  className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#7B38FB] data-[state=active]:to-[#FF5BA8] data-[state=active]:text-white text-white/70"
                >
                  <Briefcase className="w-4 h-4 mr-2" />
                  Applications ({applications?.length || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="mt-6">
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-white flex items-center gap-2">
                          <UserCheck className="h-5 w-5 text-[#7B38FB]" />
                          Profile Information
                        </CardTitle>
                        <CardDescription className="text-white/70">
                          Keep your profile updated to improve your job matches
                        </CardDescription>
                      </div>
                      {!editingProfile && (
                        <Button 
                          onClick={handleEditProfile}
                          className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                        >
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
                            className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            rows={4}
                          />
                        </div>

                        <div>
                          <Label htmlFor="location" className="text-white">Location</Label>
                          <Input
                            id="location"
                            placeholder="City, Country"
                            value={profileData.location}
                            onChange={(e) => setProfileData({ ...profileData, location: e.target.value })}
                            className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                          />
                        </div>

                        <div>
                          <Label htmlFor="linkedin" className="text-white">LinkedIn URL</Label>
                          <Input
                            id="linkedin"
                            placeholder="https://linkedin.com/in/yourprofile"
                            value={profileData.linkedin}
                            onChange={(e) => setProfileData({ ...profileData, linkedin: e.target.value })}
                            className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
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
                              className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            />
                            <Button 
                              onClick={handleAddSkill} 
                              variant="outline" 
                              size="sm"
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {profileData.skills.map((skill, index) => (
                              <Badge 
                                key={index} 
                                variant="outline" 
                                className="border-purple-400/30 text-purple-300 group hover:border-red-400/50 hover:text-red-300 cursor-pointer"
                                onClick={() => handleRemoveSkill(skill)}
                              >
                                {skill}
                                <X className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button 
                            onClick={handleSaveProfile}
                            disabled={updateProfileMutation.isPending}
                            className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            {updateProfileMutation.isPending ? "Saving..." : "Save Profile"}
                          </Button>
                          <Button 
                            variant="outline" 
                            onClick={() => setEditingProfile(false)}
                            className="border-white/20 text-white hover:bg-white/10"
                          >
                            <X className="w-4 h-4 mr-2" />
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {profile ? (
                          <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                  <User className="w-5 h-5 text-[#7B38FB]" />
                                  <div>
                                    <p className="text-white font-medium">{user.username}</p>
                                    <p className="text-white/60 text-sm">Username</p>
                                  </div>
                                </div>
                                
                                {profile.location && (
                                  <div className="flex items-center gap-3">
                                    <MapPin className="w-5 h-5 text-[#7B38FB]" />
                                    <div>
                                      <p className="text-white font-medium">{profile.location}</p>
                                      <p className="text-white/60 text-sm">Location</p>
                                    </div>
                                  </div>
                                )}
                                
                                {profile.linkedin && (
                                  <div className="flex items-center gap-3">
                                    <Linkedin className="w-5 h-5 text-[#7B38FB]" />
                                    <div>
                                      <a
                                        href={profile.linkedin}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#7B38FB] hover:text-[#FF5BA8] font-medium transition-colors"
                                      >
                                        LinkedIn Profile
                                      </a>
                                      <p className="text-white/60 text-sm">Professional Profile</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {profile.skills && profile.skills.length > 0 && (
                              <div>
                                <Label className="text-white font-medium flex items-center gap-2 mb-3">
                                  <Star className="w-4 h-4 text-[#7B38FB]" />
                                  Skills
                                </Label>
                                <div className="flex flex-wrap gap-2">
                                  {profile.skills.map((skill, index) => (
                                    <Badge key={index} variant="outline" className="border-purple-400/30 text-purple-300">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {profile.bio && (
                              <div>
                                <Label className="text-white font-medium flex items-center gap-2 mb-3">
                                  <User className="w-4 h-4 text-[#7B38FB]" />
                                  Bio
                                </Label>
                                <p className="text-white/80 leading-relaxed p-4 bg-white/5 rounded-lg border border-white/10">{profile.bio}</p>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center py-12">
                            <User className="w-16 h-16 text-white/40 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-white mb-2">Complete Your Profile</h3>
                            <p className="text-white/70 mb-6 max-w-md mx-auto">
                              Add your information to auto-fill job applications and showcase your skills to potential employers.
                            </p>
                            <Button 
                              onClick={handleEditProfile} 
                              className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Create Profile
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="applications" className="mt-6">
                {applications && applications.length > 0 ? (
                  <div className="space-y-4">
                    {applications.map((application) => (
                      <ApplicationCard key={application.id} application={application} />
                    ))}
                  </div>
                ) : (
                  <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                    <CardContent className="text-center py-12">
                      <Briefcase className="w-16 h-16 text-white/40 mx-auto mb-4" />
                      <h3 className="text-xl font-semibold text-white mb-2">No Applications Yet</h3>
                      <p className="text-white/70 mb-6">
                        Start applying to jobs to see your applications here.
                      </p>
                      <Button 
                        onClick={() => window.location.href = '/jobs'}
                        className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                      >
                        <Briefcase className="w-4 h-4 mr-2" />
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