import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { MapPin, Clock, Calendar, Users, FileText, Upload, Briefcase, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Job, insertApplicationSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { z } from "zod";
import Layout from "@/components/Layout";

export default function JobDetailsPage() {
  const [match, params] = useRoute("/jobs/:id");
  const { toast } = useToast();
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    coverLetter: "",
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const jobId = params?.id ? parseInt(params.id) : null;

  // Fade-in animation on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  const { data: job, isLoading, error } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    enabled: !!jobId,
  });

  const applicationMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await fetch(`/api/jobs/${jobId}/apply`, {
        method: "POST",
        body: data,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to submit application");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Application submitted successfully",
        description: "We'll review your application and get back to you soon.",
      });
      setShowApplicationForm(false);
      setFormData({ name: "", email: "", phone: "", coverLetter: "" });
      setResumeFile(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to submit application",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!resumeFile) {
      toast({
        title: "Resume required",
        description: "Please upload your resume to continue.",
        variant: "destructive",
      });
      return;
    }

    try {
      const validatedData = insertApplicationSchema.parse({
        ...formData,
        jobId: jobId!,
      });

      const formDataToSend = new FormData();
      Object.entries(validatedData).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          formDataToSend.append(key, value.toString());
        }
      });
      
      if (resumeFile) {
        formDataToSend.append('resume', resumeFile);
      }

      applicationMutation.mutate(formDataToSend);
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

  const formatDate = (dateString: string | Date) => {
    const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (!match || !jobId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center text-white">
            <h1 className="text-2xl font-bold mb-2">Job Not Found</h1>
            <p>The job you're looking for doesn't exist.</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-400 mx-auto"></div>
            <p className="text-white mt-4">Loading job details...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !job) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center text-white">
            <h1 className="text-2xl font-bold mb-2">Error</h1>
            <p>Failed to load job details. Please try again.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // If SpotAxis integration is active, backend includes an externalApplyUrl
  const externalApplyUrl = (job as any)?.externalApplyUrl as string | undefined;
  const externalJobUrl = (job as any)?.externalJobUrl as string | undefined;

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-[100px] animate-pulse-slow"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
        
        <div className={`container mx-auto px-4 py-8 relative z-10 transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
          <div className="max-w-4xl mx-auto">
            {/* Premium Header */}
            <div className="mb-12 pt-16">
              <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mb-6 animate-slide-right"></div>
              <div className="flex items-center gap-3 mb-4">
                <Briefcase className="h-8 w-8 text-[#7B38FB]" />
                <h1 className="text-4xl md:text-5xl font-bold">
                  <span className="animate-gradient-text">Job</span>
                  <span className="text-white ml-3">Details</span>
                </h1>
              </div>
              <p className="text-lg md:text-xl text-white/80 max-w-2xl leading-relaxed animate-slide-up" style={{ animationDelay: '0.3s' }}>
                Explore this opportunity and submit your application
              </p>
            </div>

            {/* Job Header */}
            <Card className="mb-8 bg-white/10 backdrop-blur-sm border-white/20 premium-card animate-slide-up" style={{ animationDelay: '0.5s' }}>
              <CardHeader>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <CardTitle className="text-3xl font-bold text-white mb-2">
                      {job.title}
                    </CardTitle>
                    <CardDescription className="text-gray-300 text-lg flex items-center gap-6">
                      <span className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        {job.location}
                      </span>
                      <span className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Posted {formatDate(job.createdAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <Badge 
                    variant="secondary" 
                    className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-lg px-4 py-2"
                  >
                    {job.type.replace('-', ' ')}
                  </Badge>
                </div>

                {externalJobUrl && (
                  <div className="mb-2">
                    <a href={externalJobUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
                        View on SpotAxis
                      </Button>
                    </a>
                  </div>
                )}

                {job.deadline && (
                  <div className="flex items-center gap-2 text-orange-300">
                    <Calendar className="h-5 w-5" />
                    <span>Application Deadline: {formatDate(job.deadline)}</span>
                  </div>
                )}
              </CardHeader>
            </Card>

            <div className="grid lg:grid-cols-3 gap-8">
              {/* Job Description */}
              <div className="lg:col-span-2 space-y-6">
                <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                      <FileText className="h-5 w-5 text-[#7B38FB]" />
                      Job Description
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-invert max-w-none">
                      <p className="text-white/90 leading-relaxed whitespace-pre-wrap">
                        {job.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {job.skills && job.skills.length > 0 && (
                  <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card">
                    <CardHeader>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Star className="h-5 w-5 text-[#7B38FB]" />
                        Required Skills
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {job.skills.map((skill, index) => (
                          <Badge 
                            key={index} 
                            variant="outline" 
                            className="border-purple-400/30 text-purple-300 bg-purple-400/10"
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Application Form / External Apply */}
              <div className="space-y-6">
                {externalApplyUrl ? (
                  <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card sticky top-8">
                    <CardHeader>
                      <CardTitle className="text-white">Apply on SpotAxis</CardTitle>
                      <CardDescription className="text-white/70">
                        You’ll be redirected to complete your application on SpotAxis.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <a href={externalApplyUrl} target="_blank" rel="noopener noreferrer">
                        <Button className="w-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:scale-105" size="lg">
                          Apply on SpotAxis
                        </Button>
                      </a>
                    </CardContent>
                  </Card>
                ) : (
                  !showApplicationForm ? (
                    <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card sticky top-8">
                      <CardHeader>
                        <CardTitle className="text-white">Apply for this position</CardTitle>
                        <CardDescription className="text-white/70">
                          Ready to take the next step in your career?
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button 
                          onClick={() => setShowApplicationForm(true)}
                          className="w-full bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300 hover:scale-105"
                          size="lg"
                        >
                          Apply Now
                        </Button>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card className="bg-white/10 backdrop-blur-sm border-white/20 premium-card sticky top-8">
                      <CardHeader>
                        <CardTitle className="text-white">Submit Application</CardTitle>
                        <CardDescription className="text-white/70">
                          Fill out the form below to apply for this position
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                          <div>
                            <Label htmlFor="name" className="text-white">Full Name *</Label>
                            <Input
                              id="name"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              required
                              className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            />
                          </div>

                          <div>
                            <Label htmlFor="email" className="text-white">Email *</Label>
                            <Input
                              id="email"
                              type="email"
                              value={formData.email}
                              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                              required
                              className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            />
                          </div>

                          <div>
                            <Label htmlFor="phone" className="text-white">Phone *</Label>
                            <Input
                              id="phone"
                              type="tel"
                              value={formData.phone}
                              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                              required
                              className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            />
                          </div>

                          <div>
                            <Label htmlFor="resume" className="text-white">Resume (PDF) *</Label>
                            <div className="relative">
                              <Input
                                id="resume"
                                type="file"
                                accept=".pdf"
                                onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                                required
                                className="bg-white/5 border-white/20 text-white file:bg-purple-500 file:text-white file:border-0 file:rounded file:px-4 file:py-2"
                              />
                              <Upload className="absolute right-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
                            </div>
                            {resumeFile && (
                              <p className="text-sm text-green-400 mt-1">
                                Selected: {resumeFile.name}
                              </p>
                            )}
                          </div>

                          <div>
                            <Label htmlFor="coverLetter" className="text-white">Cover Letter</Label>
                            <Textarea
                              id="coverLetter"
                              value={formData.coverLetter}
                              onChange={(e) => setFormData({ ...formData, coverLetter: e.target.value })}
                              placeholder="Tell us why you're perfect for this role..."
                              rows={4}
                              className="bg-white/5 border-white/20 text-white placeholder:text-gray-400 focus:border-[#7B38FB] focus:ring-2 focus:ring-[#7B38FB]/20 transition-all duration-300"
                            />
                          </div>

                          <div className="flex gap-2">
                            <Button 
                              type="submit" 
                              disabled={applicationMutation.isPending}
                              className="flex-1 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] hover:shadow-lg hover:shadow-purple-500/20 transition-all duration-300"
                            >
                              {applicationMutation.isPending ? "Submitting..." : "Submit Application"}
                            </Button>
                            <Button 
                              type="button" 
                              variant="outline" 
                              onClick={() => setShowApplicationForm(false)}
                              className="border-white/20 text-white hover:bg-white/10"
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      </CardContent>
                    </Card>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
