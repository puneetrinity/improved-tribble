import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { Save, AlertCircle, IndianRupee, GraduationCap, Sparkles, Briefcase, Tag, Plus, X, Info, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Client, Job } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { JobSubNav } from "@/components/JobSubNav";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageHeaderSkeleton } from "@/components/skeletons";
import { CoRecruiterManagement } from "@/components/CoRecruiterManagement";
import { jobEditPageCopy } from "@/lib/internal-copy";

const MIN_DESCRIPTION_WORDS = 200;
const countWords = (value: string): number =>
  value
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

export default function JobEditPage() {
  const [match, params] = useRoute("/jobs/:id/edit");
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    type: "full-time",
    skills: [] as string[],
    goodToHaveSkills: [] as string[],
    salaryMin: "",
    salaryMax: "",
    salaryPeriod: "per_month" as "per_month" | "per_year",
    educationRequirement: "",
    experienceYears: "",
  });
  const [hiringManagerId, setHiringManagerId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [newSkill, setNewSkill] = useState("");
  const [newGoodToHaveSkill, setNewGoodToHaveSkill] = useState("");
  const descriptionWordCount = countWords(formData.description);
  const descriptionWordsRemaining = Math.max(0, MIN_DESCRIPTION_WORDS - descriptionWordCount);

  const jobId = params?.id ? parseInt(params.id) : null;

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if not recruiter or admin
  if (!user || !['recruiter', 'super_admin'].includes(user.role)) {
    return <Redirect to="/recruiter-auth" />;
  }

  const { data: job, isLoading } = useQuery<Job>({
    queryKey: ["/api/jobs", jobId],
    queryFn: async () => {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) throw new Error("Failed to fetch job");
      return response.json();
    },
    enabled: !!jobId,
  });

  const { data: hiringManagers = [] } = useQuery<
    Array<{ id: number; username: string; firstName: string | null; lastName: string | null }>
  >({
    queryKey: ["/api/users", { role: "hiring_manager" }],
    queryFn: async () => {
      const response = await fetch("/api/users?role=hiring_manager", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch hiring managers");
      return response.json();
    },
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const response = await fetch("/api/clients", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch clients");
      return response.json();
    },
  });

  // Populate form when job loads
  useEffect(() => {
    if (job) {
      setFormData({
        title: job.title,
        description: job.description,
        location: job.location,
        type: job.type,
        skills: job.skills || [],
        goodToHaveSkills: job.goodToHaveSkills || [],
        salaryMin: job.salaryMin ? String(job.salaryMin) : "",
        salaryMax: job.salaryMax ? String(job.salaryMax) : "",
        salaryPeriod: (job.salaryPeriod as "per_month" | "per_year") || "per_month",
        educationRequirement: job.educationRequirement || "",
        experienceYears: job.experienceYears ? String(job.experienceYears) : "",
      });
      setHiringManagerId(job.hiringManagerId ? String(job.hiringManagerId) : "");
      setClientId(job.clientId ? String(job.clientId) : "");
    }
  }, [job]);

  const updateJobMutation = useMutation({
    mutationFn: async (data: Partial<Job>) => {
      const res = await apiRequest("PATCH", `/api/jobs/${jobId}`, data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-jobs"] });
      toast({
        title: jobEditPageCopy.toasts.successTitle,
        description: jobEditPageCopy.toasts.successDescription,
      });
    },
    onError: (error: Error) => {
      toast({
        title: jobEditPageCopy.toasts.errorTitle,
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateJobMutation.mutate({
      title: formData.title,
      description: formData.description,
      location: formData.location,
      type: formData.type,
      skills: formData.skills,
      goodToHaveSkills: formData.goodToHaveSkills.length > 0 ? formData.goodToHaveSkills : null,
      salaryMin: formData.salaryMin ? Number(formData.salaryMin) : null,
      salaryMax: formData.salaryMax ? Number(formData.salaryMax) : null,
      salaryPeriod: formData.salaryPeriod || null,
      educationRequirement: formData.educationRequirement || null,
      experienceYears: formData.experienceYears ? Number(formData.experienceYears) : null,
      hiringManagerId: hiringManagerId ? Number(hiringManagerId) : null,
      clientId: clientId ? Number(clientId) : null,
    });
  };

  // Handle adding required skill
  const handleAddSkill = () => {
    if (newSkill.trim() && !formData.skills.includes(newSkill.trim())) {
      setFormData({ ...formData, skills: [...formData.skills, newSkill.trim()] });
      setNewSkill("");
    }
  };

  // Handle adding good-to-have skill
  const handleAddGoodToHaveSkill = () => {
    if (newGoodToHaveSkill.trim() && !formData.goodToHaveSkills.includes(newGoodToHaveSkill.trim())) {
      setFormData({ ...formData, goodToHaveSkills: [...formData.goodToHaveSkills, newGoodToHaveSkill.trim()] });
      setNewGoodToHaveSkill("");
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 pb-10 pt-5">
          <div className="max-w-4xl mx-auto space-y-4">
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
              <h3 className="text-xl font-semibold text-foreground mb-2">{jobEditPageCopy.empty.title}</h3>
              <p className="text-muted-foreground">{jobEditPageCopy.empty.description}</p>
            </CardContent>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={`container mx-auto px-4 pb-10 pt-5 transition-opacity duration-500 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="max-w-4xl mx-auto">
          {/* Compact header: breadcrumb back-context + job title; the single job navigation follows */}
          <PageHeader
            title={job.title}
            description={jobEditPageCopy.form.description}
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
                {jobEditPageCopy.empty.back}
              </Button>
            }
            className="mb-3"
          />
          <JobSubNav jobId={jobId!} className="mb-4" />

          {/* Edit Form */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-foreground">{jobEditPageCopy.form.title}</CardTitle>
              <CardDescription>{jobEditPageCopy.form.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="title">Job Title</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="type">Job Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) =>
                      setFormData((prev) => {
                        const nextType = value as typeof prev.type;
                        let nextLocation = prev.location;
                        if (nextType === "remote" && !nextLocation.trim()) {
                          nextLocation = "Remote";
                        } else if (prev.type === "remote" && nextType !== "remote" && nextLocation.trim().toLowerCase() === "remote") {
                          nextLocation = "";
                        }
                        return { ...prev, type: nextType, location: nextLocation };
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full-time">Full Time</SelectItem>
                      <SelectItem value="part-time">Part Time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="internship">Internship</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="flex items-center gap-2">
                    Description
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>A detailed job description improves AI candidate matching. Include responsibilities, team culture, and specific requirements for best results.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={8}
                    required
                  />
                  <p className="text-sm text-muted-foreground">
                    {descriptionWordCount}/{MIN_DESCRIPTION_WORDS} words
                  </p>
                  {/* SEO warning for short descriptions */}
                  {descriptionWordCount > 0 && descriptionWordCount < MIN_DESCRIPTION_WORDS && (
                    <div className="flex items-start gap-2 p-2 bg-amber-50 border border-amber-200 rounded text-sm">
                      <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <p className="text-amber-800">
                        <strong>SEO tip:</strong> Descriptions under {MIN_DESCRIPTION_WORDS} words may not appear in Google Jobs.
                        {descriptionWordsRemaining > 0 && ` Add ${descriptionWordsRemaining} more words for better visibility.`}
                      </p>
                    </div>
                  )}
                </div>

                {/* Salary Section */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <IndianRupee className="h-4 w-4 text-muted-foreground" />
                    Salary / Pay (Optional)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Providing salary range helps attract candidates with matching expectations. This remains private unless you choose to share it.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={formData.salaryMin}
                        onChange={(e) => setFormData({ ...formData, salaryMin: e.target.value })}
                        placeholder="Min (e.g., 500000)"
                        min="0"
                      />
                    </div>
                    <span className="flex items-center text-muted-foreground">to</span>
                    <div className="flex-1">
                      <Input
                        type="number"
                        value={formData.salaryMax}
                        onChange={(e) => setFormData({ ...formData, salaryMax: e.target.value })}
                        placeholder="Max (e.g., 800000)"
                        min="0"
                      />
                    </div>
                    <Select
                      value={formData.salaryPeriod}
                      onValueChange={(value: "per_month" | "per_year") =>
                        setFormData({ ...formData, salaryPeriod: value })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_month">Per Month</SelectItem>
                        <SelectItem value="per_year">Per Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Required Skills Section */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    Required Skills (Non-negotiable)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>AI will recommend "hold" or "reject" for candidates missing these skills. Only add truly non-negotiable skills here.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <div className="flex gap-2 mb-3">
                    <Input
                      type="text"
                      value={newSkill}
                      onChange={(e) => setNewSkill(e.target.value)}
                      placeholder="Add a required skill..."
                      className="flex-1"
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddSkill())}
                    />
                    <Button type="button" onClick={handleAddSkill} size="icon" aria-label="Add required skill">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {formData.skills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.skills.map((skill, index) => (
                        <Badge
                          key={`${skill}-${index}`}
                          variant="secondary"
                          className="bg-destructive/10 text-destructive border-destructive/20 pl-3 pr-1 py-1"
                        >
                          {skill}
                          <Button
                            type="button"
                            onClick={() => setFormData({ ...formData, skills: formData.skills.filter((s) => s !== skill) })}
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove required skill ${skill}`}
                            className="ml-2 p-0 h-4 w-4 hover:bg-destructive/20"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Good to Have Skills Section */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    Good to Have Skills (Optional)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>These give candidates bonus points but won't disqualify them. Great for nice-to-have technologies or soft skills.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <div className="flex gap-2 mb-3">
                    <Input
                      type="text"
                      value={newGoodToHaveSkill}
                      onChange={(e) => setNewGoodToHaveSkill(e.target.value)}
                      placeholder="Add a nice-to-have skill..."
                      className="flex-1"
                      onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), handleAddGoodToHaveSkill())}
                    />
                    <Button type="button" onClick={handleAddGoodToHaveSkill} size="icon" aria-label="Add preferred skill">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {formData.goodToHaveSkills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formData.goodToHaveSkills.map((skill, index) => (
                        <Badge
                          key={`${skill}-${index}`}
                          variant="secondary"
                          className="bg-green-500/10 text-green-600 border-green-500/20 pl-3 pr-1 py-1"
                        >
                          {skill}
                          <Button
                            type="button"
                            onClick={() => setFormData({ ...formData, goodToHaveSkills: formData.goodToHaveSkills.filter((s) => s !== skill) })}
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove preferred skill ${skill}`}
                            className="ml-2 p-0 h-4 w-4 hover:bg-green-500/20"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Education Requirement */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    Education Requirement (Optional)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>Specify education requirements to help AI assess candidate qualifications more accurately.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    type="text"
                    value={formData.educationRequirement}
                    onChange={(e) => setFormData({ ...formData, educationRequirement: e.target.value })}
                    placeholder="e.g., Bachelor's in Computer Science or equivalent"
                  />
                </div>

                {/* Experience Years */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    Preferred Experience (Years)
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>AI uses experience requirements to match candidates at the right seniority level for this role.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    max="50"
                    value={formData.experienceYears}
                    onChange={(e) => setFormData({ ...formData, experienceYears: e.target.value })}
                    placeholder="e.g., 3"
                    className="w-32"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="hiringManager">Hiring Manager (Optional)</Label>
                    <Select
                      value={hiringManagerId || "__none__"}
                      onValueChange={(val) => setHiringManagerId(val === "__none__" ? "" : val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a hiring manager..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {hiringManagers.map((hm) => (
                          <SelectItem key={hm.id} value={hm.id.toString()}>
                            {hm.firstName && hm.lastName
                              ? `${hm.firstName} ${hm.lastName} (${hm.username})`
                              : hm.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="client">Client (Optional)</Label>
                    <Select
                      value={clientId || "__none__"}
                      onValueChange={(val) => setClientId(val === "__none__" ? "" : val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Internal role / no client" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Internal / No client</SelectItem>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id.toString()}>
                            {client.name}
                            {client.domain ? ` (${client.domain})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={updateJobMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    {updateJobMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Co-Recruiter Management */}
          <CoRecruiterManagement jobId={jobId!} className="shadow-sm" />
        </div>
      </div>
    </Layout>
  );
}
