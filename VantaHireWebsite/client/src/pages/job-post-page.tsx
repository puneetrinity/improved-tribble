import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { insertJobSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, X, Briefcase, MapPin, Calendar, FileText, Tag } from "lucide-react";
import { z } from "zod";
import Layout from "@/components/Layout";
import AIAnalysisPanel from "@/components/AIAnalysisPanel";

export default function JobPostPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check SpotAxis integration
  const { data: spotaxis } = useQuery<{ enabled: boolean; baseUrl?: string | null }>({
    queryKey: ["/api/integrations/spotaxis"],
  });
  
  const [formData, setFormData] = useState({
    title: "",
    location: "",
    type: "full-time" as const,
    description: "",
    deadline: "",
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");

  // Redirect if not authenticated or not a recruiter/admin
  if (!user) {
    return <Redirect to="/auth" />;
  }

  if (!['recruiter', 'admin'].includes(user.role)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p>You need recruiter or admin privileges to post jobs.</p>
        </div>
      </div>
    );
  }

  const jobMutation = useMutation({
    mutationFn: async (data: typeof formData & { skills: string[] }) => {
      const response = await apiRequest("POST", "/api/jobs", data);
      return response.json();
    },
    onSuccess: (job) => {
      toast({
        title: "Job posted successfully!",
        description: `${job.title} has been posted and is now live.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      setLocation("/jobs");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to post job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter(skill => skill !== skillToRemove));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const jobData = {
        ...formData,
        skills,
        deadline: formData.deadline || undefined,
      };

      insertJobSchema.parse(jobData);
      jobMutation.mutate(jobData as any);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation error",
          description: error.errors[0].message,
          variant: "destructive",
        });
      }
    }
  };

  // If SpotAxis mode, guide recruiter to manage jobs there
  if (spotaxis?.enabled) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <Card className="bg-white/10 backdrop-blur-sm border-white/20">
              <CardHeader>
                <CardTitle className="text-white">Create Job on SpotAxis</CardTitle>
                <CardDescription className="text-white/70">
                  Job creation, templates, and pipelines are managed within SpotAxis.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/spotaxis/job/new">
                  <Button className="bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8]">Open SpotAxis Job Creator</Button>
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-white mb-4">
              Post a New <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">Job</span>
            </h1>
            <p className="text-xl text-gray-300">
              Find the perfect candidate for your team
            </p>
          </div>

          <Card className="bg-white/10 backdrop-blur-sm border-white/20">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Briefcase className="h-6 w-6" />
                Job Details
              </CardTitle>
              <CardDescription className="text-gray-300">
                Fill out the information below to create your job posting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Job Title */}
                <div>
                  <Label htmlFor="title" className="text-white flex items-center gap-2 mb-2">
                    <FileText className="h-4 w-4" />
                    Job Title *
                  </Label>
                  <Input
                    id="title"
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                    placeholder="e.g. Senior Software Engineer"
                    className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                  />
                </div>

                {/* Location and Type */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="location" className="text-white flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4" />
                      Location *
                    </Label>
                    <Input
                      id="location"
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      required
                      placeholder="e.g. San Francisco, CA"
                      className="bg-white/5 border-white/20 text-white placeholder:text-gray-400"
                    />
                  </div>

                  <div>
                    <Label htmlFor="type" className="text-white mb-2 block">Job Type *</Label>
                    <Select value={formData.type} onValueChange={(value: any) => setFormData({ ...formData, type: value })}>
                      <SelectTrigger className="bg-white/5 border-white/20 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full-time">Full-time</SelectItem>
                        <SelectItem value="part-time">Part-time</SelectItem>
                        <SelectItem value="contract">Contract</SelectItem>
                        <SelectItem value="remote">Remote</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Application Deadline */}
                <div>
                  <Label htmlFor="deadline" className="text-white flex items-center gap-2 mb-2">
                    <Calendar className="h-4 w-4" />
                    Application Deadline (Optional)
                  </Label>
                  <Input
                    id="deadline"
                    type="date"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    min={new Date().toISOString().split('T')[0]}
                    className="bg-white/5 border-white/20 text-white"
                  />
                </div>

                {/* Skills */}
                <div>
                  <Label className="text-white flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4" />
                    Required Skills
                  </Label>
                  
                  <div className="flex gap-2 mb-3">
                    <Input
                      type="text"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      placeholder="Add a skill..."
                      className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 flex-1"
                      onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddSkill())}
                    />
                    <Button
                      type="button"
                      onClick={handleAddSkill}
                      className="bg-purple-500 hover:bg-purple-600"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {skills.map((skill, index) => (
                        <Badge
                          key={index}
                          variant="secondary"
                          className="bg-blue-500/20 text-blue-300 border-blue-500/30 pl-3 pr-1 py-1"
                        >
                          {skill}
                          <Button
                            type="button"
                            onClick={() => handleRemoveSkill(skill)}
                            className="ml-2 p-0 h-4 w-4 bg-transparent hover:bg-red-500/20 text-red-300"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Job Description */}
                <div>
                  <Label htmlFor="description" className="text-white mb-2 block">
                    Job Description *
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                    placeholder="Describe the role, responsibilities, requirements, and what makes this opportunity exciting..."
                    className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 min-h-[200px]"
                  />
                  <p className="text-sm text-gray-400 mt-1">
                    {formData.description.length}/5000 characters
                  </p>
                </div>

                {/* Submit Button */}
                <div className="flex gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/jobs")}
                    className="flex-1 border-white/20 text-white hover:bg-white/10"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={jobMutation.isPending}
                    className="flex-1 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600"
                  >
                    {jobMutation.isPending ? "Posting Job..." : "Post Job"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
