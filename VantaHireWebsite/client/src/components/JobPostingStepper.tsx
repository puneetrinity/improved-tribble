import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { insertJobSchema, type Client, type Job, type EmailTemplate, type PipelineStage } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus,
  X,
  Briefcase,
  MapPin,
  Calendar,
  FileText,
  Tag,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  Mail,
  GitBranch,
  Copy,
  Info,
  Trash2,
  IndianRupee,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { JdAiAnalysisDrawer } from "@/components/jd/JdAiAnalysisDrawer";

const MIN_DESCRIPTION_WORDS = 200;
const countWords = (value: string): number =>
  value
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

// Step validation schemas
const step1Schema = z.object({
  title: z.string().min(3, "Job title must be at least 3 characters"),
  location: z.string().min(2, "Location is required"),
  type: z.enum(["full-time", "part-time", "contract", "remote"]),
  deadline: z.string().optional(),
});

const step2Schema = z.object({
  description: z.string()
    .min(10, "Description is required")
    .refine((value) => countWords(value) >= MIN_DESCRIPTION_WORDS, {
      message: `Description must be at least ${MIN_DESCRIPTION_WORDS} words`,
    }),
  skills: z.array(z.string()).optional(),
  goodToHaveSkills: z.array(z.string()).optional(),
  salaryMin: z.string().optional(),
  salaryMax: z.string().optional(),
  salaryPeriod: z.enum(["per_month", "per_year"]).optional(),
  educationRequirement: z.string().max(500).optional(),
  experienceYears: z.string().optional(),
});

const step3Schema = z.object({
  hiringManagerId: z.number().optional(),
  clientId: z.number().optional(),
});

interface JobPostingStepperProps {
  onSuccess?: () => void;
}

interface FieldError {
  field: string;
  message: string;
}

const STEPS = [
  { id: 1, title: "Basics", description: "Job title, location & type" },
  { id: 2, title: "Details", description: "Skills & description" },
  { id: 3, title: "Team", description: "Hiring manager & client" },
  { id: 4, title: "Setup", description: "Templates & pipeline" },
];

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(trimmed);
  });

  return result;
};

const splitList = (value: string): string[] =>
  dedupeStrings(
    value
      .replace(/\r?\n-\s*/g, "\n")
      .split(/\r?\n|,|;|\u2022/)
      .map((item) => item.replace(/^\-\s*/, "").replace(/^[\s:]+|[\s:]+$/g, ""))
      .filter(Boolean),
  );

const normalizeJobType = (value: string): "full-time" | "part-time" | "contract" | "remote" => {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("part")) return "part-time";
  if (normalized.includes("contract")) return "contract";
  if (normalized.includes("remote")) return "remote";
  return "full-time";
};

const parseExperienceYears = (value: string): string => {
  const match = value.match(/\d+/);
  return match ? match[0] : "";
};

const parseSalary = (value: string): Pick<ExtractedDetails, "salaryMin" | "salaryMax" | "salaryPeriod"> => {
  const cleaned = value.trim();
  const normalized = cleaned.toLowerCase();
  const matches = cleaned.match(/\d+(?:[\d,.]*\d)?/g) ?? [];
  const multiplier = normalized.includes("lpa") ? 100000 : 1;
  const numbers = matches
    .map((item) => {
      const parsed = Number(item.replace(/,/g, ""));
      if (!Number.isFinite(parsed)) {
        return "";
      }
      return String(Math.round(parsed * multiplier));
    })
    .filter(Boolean);

  return {
    salaryMin: numbers[0] ?? "",
    salaryMax: numbers[1] ?? "",
    salaryPeriod: normalized.includes("month") ? "per_month" : "per_year",
  };
};

const parseStructuredExtraction = (rawText: string): ExtractedDetails => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map<string, string>();

  lines.forEach((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    map.set(key, value);
  });

  const salary = parseSalary(map.get("salary") ?? "");
  const requiredSkills = splitList(map.get("required skills") ?? "");
  const goodToHaveSkills = splitList(map.get("good to have skills") ?? "");
  const explicitKeywords = splitList(map.get("keywords") ?? "");

  return {
    title: map.get("job title") ?? "",
    location: map.get("location") ?? "",
    type: normalizeJobType(map.get("job type") ?? ""),
    experienceYears: parseExperienceYears(map.get("experience") ?? ""),
    salaryMin: salary.salaryMin,
    salaryMax: salary.salaryMax,
    salaryPeriod: salary.salaryPeriod,
    educationRequirement: map.get("education") ?? "",
    skills: requiredSkills,
    goodToHaveSkills,
    keywords: dedupeStrings([...explicitKeywords, ...requiredSkills, ...goodToHaveSkills]),
  };
};

const formatSalary = (salaryMin: string, salaryMax: string, salaryPeriod: "per_month" | "per_year"): string => {
  if (!salaryMin && !salaryMax) {
    return "";
  }

  const formatAmount = (value: string) => `INR ${Number(value).toLocaleString("en-IN")}`;
  const periodLabel = salaryPeriod === "per_month" ? "per month" : "per year";

  if (salaryMin && salaryMax) {
    return `${formatAmount(salaryMin)} - ${formatAmount(salaryMax)} ${periodLabel}`;
  }

  if (salaryMin) {
    return `${formatAmount(salaryMin)}+ ${periodLabel}`;
  }

  return `Up to ${formatAmount(salaryMax)} ${periodLabel}`;
};

const generateOptimizedJD = (input: {
  title: string;
  location: string;
  experienceYears: string;
  salaryMin: string;
  salaryMax: string;
  salaryPeriod: "per_month" | "per_year";
  skills: string[];
  goodToHaveSkills: string[];
  keywords: string[];
}): string => {
  const requiredSkills = dedupeStrings(input.skills);
  const keywordTerms = dedupeStrings([
    ...requiredSkills,
    ...input.goodToHaveSkills,
    ...input.keywords,
  ]);

  return [
    `Job Title: ${input.title.trim()}`,
    `Location: ${input.location.trim()}`,
    `Experience: ${input.experienceYears ? `${input.experienceYears}+ years` : ""}`,
    `Salary: ${formatSalary(input.salaryMin, input.salaryMax, input.salaryPeriod)}`,
    `Required Skills: ${requiredSkills.join(", ")}`,
    "",
    `Keywords:`,
    keywordTerms.join(", "),
  ].join("\n");
};
const DEFAULT_STAGES = [
  { name: "Applied", order: 1, color: "#6b7280" },
  { name: "Screening", order: 2, color: "#3b82f6" },
  { name: "Interview", order: 3, color: "#10b981" },
  { name: "Offer", order: 4, color: "#f59e0b" },
  { name: "Hired", order: 5, color: "#22c55e" },
];

export function JobPostingStepper({ onSuccess }: JobPostingStepperProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [errors, setErrors] = useState<FieldError[]>([]);

  // Form state
  const [formData, setFormData] = useState<{
    title: string;
    location: string;
    type: "full-time" | "part-time" | "contract" | "remote";
    description: string;
    deadline: string;
    salaryMin: string;
    salaryMax: string;
    salaryPeriod: "per_month" | "per_year";
    educationRequirement: string;
    experienceYears: string;
  }>({
    title: "",
    location: "",
    type: "full-time",
    description: "",
    deadline: "",
    salaryMin: "",
    salaryMax: "",
    salaryPeriod: "per_month",
    educationRequirement: "",
    experienceYears: "",
  });
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [goodToHaveSkills, setGoodToHaveSkills] = useState<string[]>([]);
  const [newGoodToHaveSkill, setNewGoodToHaveSkill] = useState("");
  const [hiringManagerId, setHiringManagerId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const descriptionWordCount = countWords(formData.description);
  const descriptionWordsRemaining = Math.max(0, MIN_DESCRIPTION_WORDS - descriptionWordCount);

  // Setup step state
  const [cloneFromJobId, setCloneFromJobId] = useState<string>("");
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<number[]>([]);
  const [useDefaultPipeline, setUseDefaultPipeline] = useState(true);
  const [customStages, setCustomStages] = useState<{ name: string; color: string }[]>([]);
  const [newStageName, setNewStageName] = useState("");

  // Fetch hiring managers
  const { data: hiringManagers = [] } = useQuery<
    Array<{ id: number; username: string; firstName: string | null; lastName: string | null }>
  >({
    queryKey: ["/api/users", { role: "hiring_manager" }],
    queryFn: async () => {
      const response = await fetch("/api/users?role=hiring_manager", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch hiring managers");
      return response.json();
    },
    enabled: currentStep >= 3,
  });

  // Fetch clients
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const response = await fetch("/api/clients", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch clients");
      return response.json();
    },
    enabled: currentStep >= 3,
  });

  // Fetch existing jobs for template cloning
  const { data: existingJobs = [] } = useQuery<Job[]>({
    queryKey: ["/api/my-jobs"],
    queryFn: async () => {
      const response = await fetch("/api/my-jobs", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch jobs");
      return response.json();
    },
    enabled: currentStep >= 4,
  });

  // Fetch email templates
  const { data: emailTemplates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
    queryFn: async () => {
      const response = await fetch("/api/email-templates", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch templates");
      return response.json();
    },
    enabled: currentStep >= 4,
  });

  // Fetch existing pipeline stages
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
    queryFn: async () => {
      const response = await fetch("/api/pipeline/stages", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch stages");
      return response.json();
    },
    enabled: currentStep >= 4,
  });

  // Clone prefill - when a job is selected, prefill form fields
  useEffect(() => {
    if (!cloneFromJobId) return;

    const sourceJob = existingJobs.find(j => j.id.toString() === cloneFromJobId);
    if (!sourceJob) return;

    // Prefill form data with "(Copy)" suffix on title
    setFormData({
      title: `${sourceJob.title} (Copy)`,
      location: sourceJob.location,
      type: sourceJob.type as "full-time" | "part-time" | "contract" | "remote",
      description: sourceJob.description,
      deadline: "",
      salaryMin: sourceJob.salaryMin ? sourceJob.salaryMin.toString() : "",
      salaryMax: sourceJob.salaryMax ? sourceJob.salaryMax.toString() : "",
      salaryPeriod: (sourceJob.salaryPeriod as "per_month" | "per_year") || "per_month",
      educationRequirement: sourceJob.educationRequirement || "",
      experienceYears: sourceJob.experienceYears ? sourceJob.experienceYears.toString() : "",
    });

    // Prefill skills
    if (sourceJob.skills && sourceJob.skills.length > 0) {
      setSkills(sourceJob.skills);
    }

    // Prefill good-to-have skills
    if (sourceJob.goodToHaveSkills && sourceJob.goodToHaveSkills.length > 0) {
      setGoodToHaveSkills(sourceJob.goodToHaveSkills);
    }

    // Prefill hiring manager and client if set
    if (sourceJob.hiringManagerId) {
      setHiringManagerId(sourceJob.hiringManagerId.toString());
    }
    if (sourceJob.clientId) {
      setClientId(sourceJob.clientId.toString());
    }

    toast({
      title: "Job cloned",
      description: `Prefilled from "${sourceJob.title}". Review and customize as needed.`,
    });
  }, [cloneFromJobId, existingJobs]);

  // Submit mutation with Step 4 setup
  const jobMutation = useMutation({
    mutationFn: async (data: typeof formData & { skills: string[] }) => {
      // Create the job first
      const response = await apiRequest("POST", "/api/jobs", data);
      const job = await response.json();

      // Handle pipeline stage creation
      if (pipelineStages.length === 0) {
        // No stages exist - create either default or custom
        const stagesToCreate = useDefaultPipeline
          ? DEFAULT_STAGES
          : customStages.map((s, i) => ({ name: s.name, color: s.color, order: i + 1 }));

        if (stagesToCreate.length > 0) {
          try {
            for (const stage of stagesToCreate) {
              await apiRequest("POST", "/api/pipeline/stages", stage);
            }
          } catch (e) {
            console.error("Failed to create pipeline stages:", e);
          }
        }
      } else if (!useDefaultPipeline && customStages.length > 0) {
        // Stages exist but user defined custom ones - add the new custom stages
        try {
          const maxOrder = Math.max(...pipelineStages.map(s => s.order), 0);
          for (const stage of customStages) {
            await apiRequest("POST", "/api/pipeline/stages", {
              name: stage.name,
              color: stage.color,
              order: maxOrder + customStages.indexOf(stage) + 1,
            });
          }
        } catch (e) {
          console.error("Failed to create custom pipeline stages:", e);
        }
      }

      // Link selected email templates to the job (if API supports it)
      // Note: Templates are organization-wide recommendations
      if (selectedTemplateIds.length > 0) {
        console.log("Recommended templates for job:", selectedTemplateIds);
      }

      return job;
    },
    onSuccess: (job) => {
      const stagesCreated = pipelineStages.length === 0 || (!useDefaultPipeline && customStages.length > 0);
      toast({
        title: "Job posted successfully!",
        description: `${job.title} has been created${stagesCreated ? " with pipeline stages" : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pipeline/stages"] });
      if (onSuccess) {
        onSuccess();
      } else {
        setLocation(`/jobs/${job.id}/applications`);
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to post job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Get error for a specific field
  const getFieldError = (field: string): string | undefined => {
    return errors.find((e) => e.field === field)?.message;
  };

  // Validate current step
  const validateStep = (step: number): boolean => {
    setErrors([]);
    const newErrors: FieldError[] = [];

    try {
      if (step === 1) {
        step1Schema.parse({
          title: formData.title,
          location: formData.location,
          type: formData.type,
          deadline: formData.deadline || undefined,
        });
      } else if (step === 2) {
        step2Schema.parse({
          description: formData.description,
          skills,
          goodToHaveSkills,
          salaryMin: formData.salaryMin || undefined,
          salaryMax: formData.salaryMax || undefined,
          salaryPeriod: formData.salaryPeriod || undefined,
          educationRequirement: formData.educationRequirement || undefined,
          experienceYears: formData.experienceYears || undefined,
        });
      } else if (step === 3) {
        step3Schema.parse({
          hiringManagerId: hiringManagerId ? Number(hiringManagerId) : undefined,
          clientId: clientId ? Number(clientId) : undefined,
        });
      }
      // Step 4 has no required validation
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach((err) => {
          newErrors.push({
            field: err.path[0] as string,
            message: err.message,
          });
        });
        setErrors(newErrors);
      }
      return false;
    }
  };

  // Handle next step
  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 4));
    }
  };

  // Handle previous step
  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Handle submit
  const handleSubmit = () => {
    if (!validateStep(4)) return;

    try {
      const optimizedJD = generateOptimizedJD({
        title: formData.title,
        location: formData.location,
        experienceYears: formData.experienceYears,
        salaryMin: formData.salaryMin,
        salaryMax: formData.salaryMax,
        salaryPeriod: formData.salaryPeriod,
        skills,
        keywords,
      });

      const jobData = {
        title: formData.title,
        location: formData.location,
        type: formData.type,
        description: formData.description,
        skills,
        goodToHaveSkills: goodToHaveSkills.length > 0 ? goodToHaveSkills : undefined,
        deadline: formData.deadline || undefined,
        hiringManagerId: hiringManagerId ? Number(hiringManagerId) : undefined,
        clientId: clientId ? Number(clientId) : undefined,
        salaryMin: formData.salaryMin ? Number(formData.salaryMin) : undefined,
        salaryMax: formData.salaryMax ? Number(formData.salaryMax) : undefined,
        salaryPeriod: formData.salaryPeriod || undefined,
        educationRequirement: formData.educationRequirement || undefined,
        experienceYears: formData.experienceYears ? Number(formData.experienceYears) : undefined,
      };

      insertJobSchema.parse(jobData);
      jobMutation.mutate(jobData as any);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: "Validation error",
          description: error.errors[0]?.message || "Please check your input",
          variant: "destructive",
        });
      }
    }
  };

  // Handle skill add
  const handleAddSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill("");
    }
  };

  // Handle good-to-have skill add
  const handleAddGoodToHaveSkill = () => {
    if (newGoodToHaveSkill.trim() && !goodToHaveSkills.includes(newGoodToHaveSkill.trim())) {
      setGoodToHaveSkills([...goodToHaveSkills, newGoodToHaveSkill.trim()]);
      setNewGoodToHaveSkill("");
    }
  };

  // Handle template selection toggle
  const toggleTemplate = (templateId: number) => {
    setSelectedTemplateIds(prev =>
      prev.includes(templateId)
        ? prev.filter(id => id !== templateId)
        : [...prev, templateId]
    );
  };

  // Render field with inline error
  const renderFieldError = (field: string) => {
    const error = getFieldError(field);
    if (!error) return null;
    return (
      <p className="text-sm text-destructive mt-1 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" />
        {error}
      </p>
    );
  };

  // Group templates by type
  const templatesByType = emailTemplates.reduce((acc, tpl) => {
    const type = tpl.templateType || 'custom';
    if (!acc[type]) acc[type] = [];
    acc[type].push(tpl);
    return acc;
  }, {} as Record<string, EmailTemplate[]>);

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-center">
        <div className="flex items-center gap-1">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => {
                  if (step.id < currentStep) {
                    setCurrentStep(step.id);
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-lg transition-all text-sm",
                  currentStep === step.id
                    ? "bg-primary text-white"
                    : step.id < currentStep
                    ? "bg-success/20 text-success-foreground hover:bg-green-200 cursor-pointer"
                    : "bg-muted text-muted-foreground"
                )}
                disabled={step.id > currentStep}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-5 h-5 rounded-full text-xs font-medium",
                    currentStep === step.id
                      ? "bg-white/20"
                      : step.id < currentStep
                      ? "bg-green-200"
                      : "bg-muted"
                  )}
                >
                  {step.id < currentStep ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    step.id
                  )}
                </span>
                <span className="hidden md:block font-medium">{step.title}</span>
              </button>
              {index < STEPS.length - 1 && (
                <ChevronRight
                  className={cn(
                    "h-4 w-4 mx-1",
                    step.id < currentStep ? "text-success" : "text-muted-foreground/50"
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-foreground text-lg">
            {STEPS[currentStep - 1]?.title}
          </CardTitle>
          <CardDescription>{STEPS[currentStep - 1]?.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Step 1: Basics */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="title" className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Job Title *
                </Label>
                <Input
                  id="title"
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g. Senior Software Engineer"
                  className={cn(getFieldError("title") && "border-destructive")}
                />
                {renderFieldError("title")}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="location" className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Location *
                  </Label>
                  <Input
                    id="location"
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g. San Francisco, CA"
                    className={cn(getFieldError("location") && "border-destructive")}
                  />
                  {renderFieldError("location")}
                </div>

                <div>
                  <Label htmlFor="type" className="mb-2 block">
                    Job Type *
                  </Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: any) =>
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
                      <SelectItem value="full-time">Full-time</SelectItem>
                      <SelectItem value="part-time">Part-time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="deadline" className="flex items-center gap-2 mb-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Application Deadline (Optional)
                </Label>
                <Input
                  id="deadline"
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
          )}

          {/* Step 2: Details */}
          {currentStep === 2 && (
            <div className="space-y-5">
              {/* Salary Section */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <IndianRupee className="h-4 w-4 text-muted-foreground" />
                  Salary / Pay (Optional - won't be visible to candidate if left blank)
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
              <div>
                <Label className="flex items-center gap-2 mb-2">
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
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill, index) => (
                      <Badge
                        key={`${skill}-${index}`}
                        variant="secondary"
                        className="bg-destructive/10 text-destructive border-destructive/20 pl-3 pr-1 py-1"
                      >
                        {skill}
                        <Button
                          type="button"
                          onClick={() => setSkills(skills.filter((s) => s !== skill))}
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
              <div>
                <Label className="flex items-center gap-2 mb-2">
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
                {goodToHaveSkills.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {goodToHaveSkills.map((skill, index) => (
                      <Badge
                        key={`${skill}-${index}`}
                        variant="secondary"
                        className="bg-green-500/10 text-green-600 border-green-500/20 pl-3 pr-1 py-1"
                      >
                        {skill}
                        <Button
                          type="button"
                          onClick={() => setGoodToHaveSkills(goodToHaveSkills.filter((s) => s !== skill))}
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
              <div>
                <Label className="flex items-center gap-2 mb-2">
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
              <div>
                <Label className="flex items-center gap-2 mb-2">
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

              {/* Job Description */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="description" className="flex items-center gap-2">
                    Job Description *
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>A detailed job description improves AI candidate matching. Include responsibilities, team culture, and specific requirements for best results.</p>
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Button variant="outline" size="sm" onClick={() => setShowAiDrawer(true)}>
                    Analyze JD (AI)
                  </Button>
                </div>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the role, responsibilities, and what makes this opportunity exciting..."
                  className={cn("min-h-[200px]", getFieldError("description") && "border-destructive")}
                />
                <div className="flex justify-between mt-1">
                  {renderFieldError("description") || (
                    <p className="text-sm text-muted-foreground">
                      {descriptionWordCount}/{MIN_DESCRIPTION_WORDS} words
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {descriptionWordsRemaining > 0 ? `${descriptionWordsRemaining} more words needed` : ""}
                  </p>
                </div>
                {/* SEO warning for short descriptions */}
                {descriptionWordCount > 0 && descriptionWordCount < MIN_DESCRIPTION_WORDS && (
                  <div className="flex items-start gap-2 mt-2 p-2 bg-warning/10 border border-warning/30 rounded text-sm">
                    <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                    <p className="text-warning-foreground">
                      <strong>SEO tip:</strong> Descriptions under {MIN_DESCRIPTION_WORDS} words may not appear in Google Jobs search results.
                      Add {descriptionWordsRemaining} more words for better visibility.
                    </p>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">Clear, inclusive descriptions improve apply rates.</p>
              </div>
            </div>
          )}

          {/* Step 3: Team */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="hiringManager" className="flex items-center gap-2 mb-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Hiring Manager (Optional)
                  </Label>
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

                <div>
                  <Label htmlFor="client" className="flex items-center gap-2 mb-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    Client (Optional)
                  </Label>
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
            </div>
          )}

          {/* Step 4: Setup (Templates & Pipeline) */}
          {currentStep === 4 && (
            <div className="space-y-6">
              {/* Clone from existing job */}
              {existingJobs.length > 0 && (
                <div>
                  <Label className="flex items-center gap-2 mb-2">
                    <Copy className="h-4 w-4 text-muted-foreground" />
                    Clone Settings From (Optional)
                  </Label>
                  <Select
                    value={cloneFromJobId || "__none__"}
                    onValueChange={(val) => setCloneFromJobId(val === "__none__" ? "" : val)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Start fresh" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Start fresh</SelectItem>
                      {existingJobs.map((job) => (
                        <SelectItem key={job.id} value={job.id.toString()}>
                          {job.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clone email templates and pipeline configuration from an existing job
                  </p>
                </div>
              )}

              {/* Email Templates */}
              <div>
                <Label className="flex items-center gap-2 mb-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email Templates
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-sm">
                        Templates are organization-wide and can be used across all jobs.
                        Select the ones you plan to use for this position.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </Label>
                <div className="space-y-3">
                  {Object.entries(templatesByType).map(([type, templates]) => (
                    <div key={type} className="bg-muted/50 rounded-lg p-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase mb-2">
                        {type.replace(/_/g, ' ')}
                      </p>
                      <div className="space-y-2">
                        {templates.map((tpl) => (
                          <div
                            key={tpl.id}
                            className="flex items-center gap-3 bg-white rounded p-2 border border-border"
                          >
                            <Checkbox
                              checked={selectedTemplateIds.includes(tpl.id)}
                              onCheckedChange={() => toggleTemplate(tpl.id)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {tpl.name}
                              </p>
                              <p className="text-xs text-muted-foreground truncate">
                                {tpl.subject}
                              </p>
                            </div>
                            {tpl.isDefault && (
                              <Badge variant="secondary" className="text-xs">
                                Default
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {emailTemplates.length === 0 && (
                    <p className="text-sm text-muted-foreground italic">
                      No email templates available. You can create them later in Settings.
                    </p>
                  )}
                </div>
              </div>

              {/* Pipeline Stages */}
              <div>
                <Label className="flex items-center gap-2 mb-3">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  Pipeline Stages
                </Label>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={useDefaultPipeline}
                      onCheckedChange={(checked) => setUseDefaultPipeline(!!checked)}
                    />
                    <span className="text-sm text-foreground">
                      {pipelineStages.length > 0
                        ? `Use existing pipeline stages (${pipelineStages.length} stages)`
                        : "Use default pipeline stages"}
                    </span>
                  </div>

                  {useDefaultPipeline && pipelineStages.length > 0 && (
                    <div className="flex flex-wrap gap-2 ml-7">
                      {[...pipelineStages].sort((a, b) => (a.order - b.order) || (a.id - b.id)).map((stage) => (
                        <Badge
                          key={stage.id}
                          variant="outline"
                          className="text-xs"
                          style={{ borderColor: stage.color || '#6b7280' }}
                        >
                          <div
                            className="w-2 h-2 rounded-full mr-1.5"
                            style={{ backgroundColor: stage.color || '#6b7280' }}
                          />
                          {stage.name}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {pipelineStages.length === 0 && useDefaultPipeline && (
                    <div className="ml-7 p-3 bg-warning/10 rounded border border-warning/30">
                      <p className="text-sm text-amber-800">
                        No pipeline stages exist yet. Default stages will be created:
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {DEFAULT_STAGES.map((stage) => (
                          <Badge
                            key={stage.name}
                            variant="outline"
                            className="text-xs"
                            style={{ borderColor: stage.color }}
                          >
                            <div
                              className="w-2 h-2 rounded-full mr-1.5"
                              style={{ backgroundColor: stage.color }}
                            />
                            {stage.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom stages UI when default pipeline unchecked */}
                  {!useDefaultPipeline && (
                    <div className="ml-7 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {pipelineStages.length > 0
                          ? "Add custom stages to extend your existing pipeline:"
                          : "Define your custom pipeline stages:"}
                      </p>

                      {/* Existing custom stages list */}
                      {customStages.length > 0 && (
                        <div className="space-y-2">
                          {customStages.map((stage, index) => (
                            <div
                              key={`${stage.name}-${stage.color}-${index}`}
                              className="flex items-center gap-3 bg-white rounded p-2 border border-border"
                            >
                              <div
                                className="w-4 h-4 rounded-full border-2"
                                style={{ backgroundColor: stage.color, borderColor: stage.color }}
                              />
                              <span className="flex-1 text-sm font-medium text-foreground">
                                {stage.name}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove stage ${stage.name}`}
                                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                onClick={() => setCustomStages(prev => prev.filter((_, i) => i !== index))}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add new stage input */}
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value="#3b82f6"
                          onChange={(e) => {
                            const colorInput = e.target;
                            colorInput.dataset.color = e.target.value;
                          }}
                          className="w-8 h-8 rounded border border-border cursor-pointer"
                          id="newStageColor"
                        />
                        <Input
                          type="text"
                          value={newStageName}
                          onChange={(e) => setNewStageName(e.target.value)}
                          placeholder="Stage name (e.g., Technical Interview)"
                          className="flex-1"
                          onKeyPress={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (newStageName.trim()) {
                                const colorInput = document.getElementById("newStageColor") as HTMLInputElement;
                                const color = colorInput?.dataset.color || colorInput?.value || "#3b82f6";
                                setCustomStages(prev => [...prev, { name: newStageName.trim(), color }]);
                                setNewStageName("");
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          aria-label="Add custom pipeline stage"
                          onClick={() => {
                            if (newStageName.trim()) {
                              const colorInput = document.getElementById("newStageColor") as HTMLInputElement;
                              const color = colorInput?.dataset.color || colorInput?.value || "#3b82f6";
                              setCustomStages(prev => [...prev, { name: newStageName.trim(), color }]);
                              setNewStageName("");
                            }
                          }}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      {customStages.length === 0 && pipelineStages.length === 0 && (
                        <p className="text-xs text-warning">
                          Add at least one stage or switch back to use default pipeline.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Review Summary */}
              <div className="bg-muted/50 rounded-lg p-4 border border-border">
                <h4 className="font-medium text-foreground mb-3">Review Your Job Posting</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Title:</span>
                    <span className="text-foreground font-medium">{formData.title || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Location:</span>
                    <span className="text-foreground">{formData.location || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="text-foreground capitalize">{formData.type}</span>
                  </div>
                  {(formData.salaryMin || formData.salaryMax) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Salary:</span>
                      <span className="text-foreground">
                        {formData.salaryMin && formData.salaryMax
                          ? `₹${Number(formData.salaryMin).toLocaleString('en-IN')} - ₹${Number(formData.salaryMax).toLocaleString('en-IN')}`
                          : formData.salaryMin
                          ? `₹${Number(formData.salaryMin).toLocaleString('en-IN')}+`
                          : `Up to ₹${Number(formData.salaryMax).toLocaleString('en-IN')}`}
                        {formData.salaryPeriod === 'per_month' ? '/month' : '/year'}
                      </span>
                    </div>
                  )}
                  {skills.length > 0 && (
                    <div className="flex justify-between items-start">
                      <span className="text-muted-foreground">Required Skills:</span>
                      <span className="text-foreground">{skills.length} added</span>
                    </div>
                  )}
                  {goodToHaveSkills.length > 0 && (
                    <div className="flex justify-between items-start">
                      <span className="text-muted-foreground">Good to Have:</span>
                      <span className="text-foreground">{goodToHaveSkills.length} added</span>
                    </div>
                  )}
                  {formData.educationRequirement && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Education:</span>
                      <span className="text-foreground truncate max-w-[200px]">{formData.educationRequirement}</span>
                    </div>
                  )}
                  {formData.experienceYears && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Experience:</span>
                      <span className="text-foreground">{formData.experienceYears}+ years</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Templates:</span>
                    <span className="text-foreground">{selectedTemplateIds.length} selected</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t border-border">
            <Button
              type="button"
              variant="outline"
              onClick={currentStep === 1 ? () => setLocation("/my-jobs") : handlePrevious}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              {currentStep === 1 ? "Cancel" : "Previous"}
            </Button>

            {currentStep < 4 ? (
              <Button type="button" onClick={handleNext}>
                Next
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={jobMutation.isPending}
                className="bg-success hover:bg-success/80"
              >
                {jobMutation.isPending ? "Posting..." : "Post Job"}
                <Check className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
      </CardContent>
    </Card>

    <JdAiAnalysisDrawer
      open={showAiDrawer}
      onOpenChange={setShowAiDrawer}
      title={formData.title}
      description={formData.description}
      onReplaceDescription={(text) => {
        setFormData((prev) => ({ ...prev, description: text }));
        setShowAiDrawer(false);
      }}
    />
  </div>
);
}
