import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { insertJobSchema, type Client, type Job } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getCsrfToken } from "@/lib/csrf";
import {
  Plus,
  X,
  Briefcase,
  MapPin,
  FileText,
  Tag,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  Info,
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
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

const step1Schema = z.object({
  description: z.string()
    .min(10, "Description is required")
    .refine((value) => countWords(value) >= MIN_DESCRIPTION_WORDS, {
      message: `Description must be at least ${MIN_DESCRIPTION_WORDS} words`,
    }),
});

const step2Schema = z.object({
  title: z.string().min(3, "Job title must be at least 3 characters"),
  location: z.string().min(2, "Location is required"),
  type: z.enum(["full-time", "part-time", "contract", "remote"]),
  skills: z.array(z.string()).optional(),
  goodToHaveSkills: z.array(z.string()).optional(),
  salaryMin: z.string().optional(),
  salaryMax: z.string().optional(),
  salaryPeriod: z.enum(["per_month", "per_year"]).optional(),
  educationRequirement: z.string().max(500).optional(),
  experienceYears: z.string().min(1, "Experience is required"),
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

interface ExtractedDetails {
  title: string;
  location: string;
  type: "full-time" | "part-time" | "contract" | "remote";
  experienceYears: string;
  salaryMin: string;
  salaryMax: string;
  salaryPeriod: "per_month" | "per_year";
  educationRequirement: string;
  skills: string[];
  goodToHaveSkills: string[];
  keywords: string[];
}

const STEPS = [
  { id: 1, title: "Job Description", description: "Paste the original job description" },
  { id: 2, title: "Details", description: "Review and edit the original details layout" },
  { id: 3, title: "Team", description: "Hiring manager & client" },
  { id: 4, title: "Review & Post", description: "Review and confirm all job details before posting" },
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
  keywords: string[];
}): string => {
  const requiredSkills = dedupeStrings(input.skills);
  const keywords = dedupeStrings([...input.keywords, ...requiredSkills]);

  return [
    `Job Title: ${input.title.trim()}`,
    `Location: ${input.location.trim()}`,
    `Experience: ${input.experienceYears ? `${input.experienceYears}+ years` : ""}`,
    `Salary: ${formatSalary(input.salaryMin, input.salaryMax, input.salaryPeriod)}`,
    `Required Skills: ${requiredSkills.join(", ")}`,
    `Keywords: ${keywords.join(", ")}`,
  ].join("\n");
};

export function JobPostingStepper({ onSuccess }: JobPostingStepperProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [isEditing, setIsEditing] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [formData, setFormData] = useState<{
    title: string;
    location: string;
    type: "full-time" | "part-time" | "contract" | "remote";
    description: string;
    optimizedDescription: string;
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
    optimizedDescription: "",
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
  const [keywords, setKeywords] = useState<string[]>([]);
  const [hiringManagerId, setHiringManagerId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [hasExtractedDetails, setHasExtractedDetails] = useState(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const descriptionWordCount = countWords(formData.description);
  const descriptionWordsRemaining = Math.max(0, MIN_DESCRIPTION_WORDS - descriptionWordCount);

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

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const response = await fetch("/api/clients", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch clients");
      return response.json();
    },
    enabled: currentStep >= 3,
  });

  const jobMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const response = await apiRequest("POST", "/api/jobs", data);
      return response.json();
    },
    onSuccess: (job: Job) => {
      toast({
        title: "Job posted successfully!",
        description: `${job.title} has been created.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-jobs"] });
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

  const getFieldError = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const renderFieldError = (field: string) => {
    const error = getFieldError(field);
    if (!error) return null;

    return (
      <p className="mt-1 flex items-center gap-1 text-sm text-destructive">
        <AlertCircle className="h-3 w-3" />
        {error}
      </p>
    );
  };

  const clearGeneratedState = () => {
    setHasExtractedDetails(false);
    setExtractionError(null);
    setKeywords([]);
    setFormData((prev) => ({
      ...prev,
      optimizedDescription: "",
    }));
  };

  const validateStep = (step: number): boolean => {
    setErrors([]);
    const nextErrors: FieldError[] = [];

    try {
      if (step === 1) {
        step1Schema.parse({
          description: formData.description,
        });
      } else if (step === 2) {
        step2Schema.parse({
          title: formData.title,
          location: formData.location,
          type: formData.type,
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

      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        error.errors.forEach((issue) => {
          nextErrors.push({
            field: issue.path[0] as string,
            message: issue.message,
          });
        });
      }
      setErrors(nextErrors);
      return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      await handleExtractDetails();
      return;
    }

    if (!validateStep(currentStep)) return;

    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

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
        description: optimizedJD,
        original_JD: formData.description,
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

      insertJobSchema.parse({
        ...jobData,
        description: formData.description,
      });
      jobMutation.mutate(jobData);
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

  const handleAddSkill = () => {
    if (!newSkill.trim()) return;
    setSkills((prev) => dedupeStrings([...prev, newSkill]));
    setKeywords((prev) => dedupeStrings([...prev, newSkill]));
    setNewSkill("");
  };

  const handleAddGoodToHaveSkill = () => {
    if (!newGoodToHaveSkill.trim()) return;
    setGoodToHaveSkills((prev) => dedupeStrings([...prev, newGoodToHaveSkill]));
    setKeywords((prev) => dedupeStrings([...prev, newGoodToHaveSkill]));
    setNewGoodToHaveSkill("");
  };

  const removeKeywordValue = (value: string) => {
    const key = value.trim().toLowerCase();
    setKeywords((prev) => prev.filter((item) => item.trim().toLowerCase() !== key));
  };

  const handleExtractDetails = async () => {
    if (!validateStep(1) || isExtracting) return;

    try {
      setIsExtracting(true);
      setExtractionError(null);

      const response = await fetch("/api/jobs/extract-keywords", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": await getCsrfToken(),
        },
        body: JSON.stringify({ description: formData.description }),
      });

      if (!response.ok) {
        let message = "Failed to extract details";
        try {
          const payload = await response.json();
          message = payload?.error || payload?.message || message;
        } catch {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const extractedText = await response.text();
      const parsed = parseStructuredExtraction(extractedText);

      setFormData((prev) => ({
        ...prev,
        title: parsed.title || prev.title,
        location: parsed.location || prev.location,
        type: parsed.type || prev.type,
        salaryMin: parsed.salaryMin || prev.salaryMin,
        salaryMax: parsed.salaryMax || prev.salaryMax,
        salaryPeriod: parsed.salaryPeriod || prev.salaryPeriod,
        educationRequirement: parsed.educationRequirement || prev.educationRequirement,
        experienceYears: parsed.experienceYears || prev.experienceYears,
      }));
      setSkills(parsed.skills);
      setGoodToHaveSkills(parsed.goodToHaveSkills);
      setKeywords(parsed.keywords);
      setHasExtractedDetails(true);
      setCurrentStep(2);
    } catch (error) {
      setHasExtractedDetails(false);
      setExtractionError(error instanceof Error ? error.message : "Failed to extract details");
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
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
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-all",
                  currentStep === step.id
                    ? "bg-primary text-white"
                    : step.id < currentStep
                      ? "cursor-pointer bg-success/20 text-success-foreground hover:bg-green-200"
                      : "bg-muted text-muted-foreground",
                )}
                disabled={step.id > currentStep}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium",
                    currentStep === step.id
                      ? "bg-white/20"
                      : step.id < currentStep
                        ? "bg-green-200"
                        : "bg-muted",
                  )}
                >
                  {step.id < currentStep ? <Check className="h-3 w-3" /> : step.id}
                </span>
                <span className="hidden font-medium md:block">{step.title}</span>
              </button>
              {index < STEPS.length - 1 && (
                <ChevronRight
                  className={cn(
                    "mx-1 h-4 w-4",
                    step.id < currentStep ? "text-success" : "text-muted-foreground/50",
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg text-foreground">
            {STEPS[currentStep - 1]?.title}
          </CardTitle>
          <CardDescription>{STEPS[currentStep - 1]?.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {currentStep === 1 && (
            <div className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label htmlFor="description" className="flex items-center gap-2">
                    Original Job Description *
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 cursor-help text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p>A detailed job description improves extraction quality and sourcing accuracy.</p>
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
                  onChange={(e) => {
                    setFormData((prev) => ({ ...prev, description: e.target.value }));
                    clearGeneratedState();
                  }}
                  placeholder="Paste the original job description here..."
                  className={cn("min-h-[220px]", getFieldError("description") && "border-destructive")}
                />
                <div className="mt-1 flex justify-between">
                  {renderFieldError("description") || (
                    <p className="text-sm text-muted-foreground">
                      {descriptionWordCount}/{MIN_DESCRIPTION_WORDS} words
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {descriptionWordsRemaining > 0 ? `${descriptionWordsRemaining} more words needed` : ""}
                  </p>
                </div>
                {descriptionWordCount > 0 && descriptionWordCount < MIN_DESCRIPTION_WORDS && (
                  <div className="mt-2 flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2 text-sm">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
                    <p className="text-warning-foreground">
                      <strong>SEO tip:</strong> Descriptions under {MIN_DESCRIPTION_WORDS} words may not appear in Google Jobs search results.
                      Add {descriptionWordsRemaining} more words for better visibility.
                    </p>
                  </div>
                )}
                {extractionError && (
                  <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {extractionError}
                  </p>
                )}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="title" className="mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Job Title *
                  </Label>
                  <Input
                    id="title"
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g. Senior Software Engineer"
                    className={cn(getFieldError("title") && "border-destructive")}
                  />
                  {renderFieldError("title")}
                </div>

                <div>
                  <Label htmlFor="location" className="mb-2 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    Location *
                  </Label>
                  <Input
                    id="location"
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
                    placeholder="e.g. Bangalore"
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
                    onValueChange={(value: "full-time" | "part-time" | "contract" | "remote") =>
                      setFormData((prev) => ({ ...prev, type: value }))
                    }
                  >
                    <SelectTrigger className={cn(getFieldError("type") && "border-destructive")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full-time">Full-time</SelectItem>
                      <SelectItem value="part-time">Part-time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                    </SelectContent>
                  </Select>
                  {renderFieldError("type")}
                </div>

                <div>
                  <Label htmlFor="experienceYearsTop" className="mb-2 flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                    Experience *
                  </Label>
                  <Input
                    id="experienceYearsTop"
                    type="number"
                    min="0"
                    max="50"
                    value={formData.experienceYears}
                    onChange={(e) => setFormData((prev) => ({ ...prev, experienceYears: e.target.value }))}
                    placeholder="e.g. 3"
                    className={cn("w-full", getFieldError("experienceYears") && "border-destructive")}
                  />
                  {renderFieldError("experienceYears")}
                </div>
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  <IndianRupee className="h-4 w-4 text-muted-foreground" />
                  Salary / Pay (Optional - won't be visible to candidate if left blank)
                </Label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={formData.salaryMin}
                      onChange={(e) => setFormData((prev) => ({ ...prev, salaryMin: e.target.value }))}
                      placeholder="Min (e.g., 500000)"
                      min="0"
                    />
                  </div>
                  <span className="flex items-center text-muted-foreground">to</span>
                  <div className="flex-1">
                    <Input
                      type="number"
                      value={formData.salaryMax}
                      onChange={(e) => setFormData((prev) => ({ ...prev, salaryMax: e.target.value }))}
                      placeholder="Max (e.g., 800000)"
                      min="0"
                    />
                  </div>
                  <Select
                    value={formData.salaryPeriod}
                    onValueChange={(value: "per_month" | "per_year") =>
                      setFormData((prev) => ({ ...prev, salaryPeriod: value }))
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

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                  Required Skills (Non-negotiable)
                </Label>
                <div className="mb-3 flex gap-2">
                  <Input
                    type="text"
                    value={newSkill}
                    onChange={(e) => setNewSkill(e.target.value)}
                    placeholder="Add a required skill..."
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddSkill();
                      }
                    }}
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
                        className="border-destructive/20 bg-destructive/10 py-1 pl-3 pr-1 text-destructive"
                      >
                        {skill}
                        <Button
                          type="button"
                          onClick={() => {
                            setSkills((prev) => prev.filter((item) => item !== skill));
                            removeKeywordValue(skill);
                          }}
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove required skill ${skill}`}
                          className="ml-2 h-4 w-4 p-0 hover:bg-destructive/20"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  Good to Have Skills (Optional)
                </Label>
                <div className="mb-3 flex gap-2">
                  <Input
                    type="text"
                    value={newGoodToHaveSkill}
                    onChange={(e) => setNewGoodToHaveSkill(e.target.value)}
                    placeholder="Add a nice-to-have skill..."
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddGoodToHaveSkill();
                      }
                    }}
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
                        className="border-green-500/20 bg-green-500/10 py-1 pl-3 pr-1 text-green-600"
                      >
                        {skill}
                        <Button
                          type="button"
                          onClick={() => {
                            setGoodToHaveSkills((prev) => prev.filter((item) => item !== skill));
                            removeKeywordValue(skill);
                          }}
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove preferred skill ${skill}`}
                          className="ml-2 h-4 w-4 p-0 hover:bg-green-500/20"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-muted-foreground" />
                  Education Requirement (Optional)
                </Label>
                <Input
                  type="text"
                  value={formData.educationRequirement}
                  onChange={(e) => setFormData((prev) => ({ ...prev, educationRequirement: e.target.value }))}
                  placeholder="e.g., Bachelor's in Computer Science or equivalent"
                />
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="hiringManager" className="mb-2 flex items-center gap-2">
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
                  <Label htmlFor="client" className="mb-2 flex items-center gap-2">
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

          {currentStep === 4 && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#EEF0F4] bg-[#FAFBFC] p-4 sm:p-5">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">Job Overview</h4>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label className="mb-2 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        Job Title
                      </Label>
                      {isEditing ? (
                        <>
                          <Input
                            id="reviewTitle"
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder="e.g. Senior Software Engineer"
                            className={cn("border-[#E6EAF0] bg-white shadow-none", getFieldError("title") && "border-destructive")}
                          />
                          {renderFieldError("title")}
                        </>
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {formData.title || "-"}
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="mb-2 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        Location
                      </Label>
                      {isEditing ? (
                        <>
                          <Input
                            id="reviewLocation"
                            type="text"
                            value={formData.location}
                            onChange={(e) => setFormData((prev) => ({ ...prev, location: e.target.value }))}
                            placeholder="e.g. Bangalore"
                            className={cn("border-[#E6EAF0] bg-white shadow-none", getFieldError("location") && "border-destructive")}
                          />
                          {renderFieldError("location")}
                        </>
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {formData.location || "-"}
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="mb-2 block">Job Type</Label>
                      {isEditing ? (
                        <>
                          <Select
                            value={formData.type}
                            onValueChange={(value: "full-time" | "part-time" | "contract" | "remote") =>
                              setFormData((prev) => ({ ...prev, type: value }))
                            }
                          >
                            <SelectTrigger className={cn("border-[#E6EAF0] bg-white shadow-none", getFieldError("type") && "border-destructive")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="full-time">Full-time</SelectItem>
                              <SelectItem value="part-time">Part-time</SelectItem>
                              <SelectItem value="contract">Contract</SelectItem>
                              <SelectItem value="remote">Remote</SelectItem>
                            </SelectContent>
                          </Select>
                          {renderFieldError("type")}
                        </>
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {formData.type || "-"}
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="mb-2 flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        Experience
                      </Label>
                      {isEditing ? (
                        <Input
                          id="reviewExperienceYears"
                          type="number"
                          min="0"
                          max="50"
                          value={formData.experienceYears}
                          onChange={(e) => setFormData((prev) => ({ ...prev, experienceYears: e.target.value }))}
                          placeholder="e.g. 3"
                          className="w-full border-[#E6EAF0] bg-white shadow-none"
                        />
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {formData.experienceYears ? `${formData.experienceYears} years` : "-"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-2" />

              <div className="rounded-xl border border-[#EEF0F4] bg-[#FAFBFC] p-4 sm:p-5">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">Compensation & Skills</h4>
                  </div>

                  <div>
                    <Label className="mb-2 flex items-center gap-2">
                      <IndianRupee className="h-4 w-4 text-muted-foreground" />
                      Salary / Pay
                    </Label>
                    {isEditing ? (
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <Input
                            type="number"
                            value={formData.salaryMin}
                            onChange={(e) => setFormData((prev) => ({ ...prev, salaryMin: e.target.value }))}
                            placeholder="Min (e.g., 500000)"
                            min="0"
                            className="border-[#E6EAF0] bg-white shadow-none"
                          />
                        </div>
                        <span className="flex items-center text-muted-foreground">to</span>
                        <div className="flex-1">
                          <Input
                            type="number"
                            value={formData.salaryMax}
                            onChange={(e) => setFormData((prev) => ({ ...prev, salaryMax: e.target.value }))}
                            placeholder="Max (e.g., 800000)"
                            min="0"
                            className="border-[#E6EAF0] bg-white shadow-none"
                          />
                        </div>
                        <Select
                          value={formData.salaryPeriod}
                          onValueChange={(value: "per_month" | "per_year") =>
                            setFormData((prev) => ({ ...prev, salaryPeriod: value }))
                          }
                        >
                          <SelectTrigger className="w-32 border-[#E6EAF0] bg-white shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="per_month">Per Month</SelectItem>
                            <SelectItem value="per_year">Per Year</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div
                        className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                        onClick={() => setIsEditing(true)}
                      >
                        {formatSalary(formData.salaryMin, formData.salaryMax, formData.salaryPeriod) || "-"}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="mb-2 flex items-center gap-2">
                      <Tag className="h-4 w-4 text-muted-foreground" />
                      Required Skills
                    </Label>
                    {isEditing ? (
                      <div>
                        <div className="mb-3 flex gap-2">
                          <Input
                            type="text"
                            value={newSkill}
                            onChange={(e) => setNewSkill(e.target.value)}
                            placeholder="Add a required skill..."
                            className="flex-1 border-[#E6EAF0] bg-white shadow-none"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddSkill();
                              }
                            }}
                          />
                          <Button type="button" onClick={handleAddSkill} size="icon" aria-label="Add required skill">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="rounded-lg border border-[#E6EAF0] bg-white px-3 py-2">
                          {skills.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {skills.map((skill, index) => (
                                <Badge
                                  key={`${skill}-${index}`}
                                  variant="secondary"
                                  className="border-destructive/20 bg-destructive/10 py-1 pl-3 pr-1 text-destructive"
                                >
                                  {skill}
                                  <Button
                                    type="button"
                                    onClick={() => {
                                      setSkills((prev) => prev.filter((item) => item !== skill));
                                      removeKeywordValue(skill);
                                    }}
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Remove required skill ${skill}`}
                                    className="ml-2 h-4 w-4 p-0 hover:bg-destructive/20"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-foreground">-</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2"
                        onClick={() => setIsEditing(true)}
                      >
                        {skills.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {skills.map((skill, index) => (
                              <Badge
                                key={`${skill}-${index}`}
                                variant="secondary"
                                className="border-destructive/20 bg-destructive/10 py-1 pl-3 pr-3 text-destructive"
                              >
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-foreground">-</div>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="mb-2 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-muted-foreground" />
                      Good to Have Skills
                    </Label>
                    {isEditing ? (
                      <div>
                        <div className="mb-3 flex gap-2">
                          <Input
                            type="text"
                            value={newGoodToHaveSkill}
                            onChange={(e) => setNewGoodToHaveSkill(e.target.value)}
                            placeholder="Add a nice-to-have skill..."
                            className="flex-1 border-[#E6EAF0] bg-white shadow-none"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddGoodToHaveSkill();
                              }
                            }}
                          />
                          <Button type="button" onClick={handleAddGoodToHaveSkill} size="icon" aria-label="Add preferred skill">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="rounded-lg border border-[#E6EAF0] bg-white px-3 py-2">
                          {goodToHaveSkills.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {goodToHaveSkills.map((skill, index) => (
                                <Badge
                                  key={`${skill}-${index}`}
                                  variant="secondary"
                                  className="border-green-500/20 bg-green-500/10 py-1 pl-3 pr-1 text-green-600"
                                >
                                  {skill}
                                  <Button
                                    type="button"
                                    onClick={() => {
                                      setGoodToHaveSkills((prev) => prev.filter((item) => item !== skill));
                                      removeKeywordValue(skill);
                                    }}
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Remove preferred skill ${skill}`}
                                    className="ml-2 h-4 w-4 p-0 hover:bg-green-500/20"
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-foreground">-</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2"
                        onClick={() => setIsEditing(true)}
                      >
                        {goodToHaveSkills.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {goodToHaveSkills.map((skill, index) => (
                              <Badge
                                key={`${skill}-${index}`}
                                variant="secondary"
                                className="border-green-500/20 bg-green-500/10 py-1 pl-3 pr-3 text-green-600"
                              >
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-foreground">-</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-2" />

              <div className="rounded-xl border border-[#EEF0F4] bg-[#FAFBFC] p-4 sm:p-5">
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-foreground">Additional Info</h4>
                  </div>

                  <div>
                    <Label className="mb-2 flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      Education
                    </Label>
                    {isEditing ? (
                      <Input
                        type="text"
                        value={formData.educationRequirement}
                        onChange={(e) => setFormData((prev) => ({ ...prev, educationRequirement: e.target.value }))}
                        placeholder="e.g., Bachelor's in Computer Science or equivalent"
                        className="border-[#E6EAF0] bg-white shadow-none"
                      />
                    ) : (
                      <div
                        className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                        onClick={() => setIsEditing(true)}
                      >
                        {formData.educationRequirement || "-"}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <Label className="mb-2 flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Hiring Manager
                      </Label>
                      {isEditing ? (
                        <Select
                          value={hiringManagerId || "__none__"}
                          onValueChange={(val) => setHiringManagerId(val === "__none__" ? "" : val)}
                        >
                          <SelectTrigger className="border-[#E6EAF0] bg-white shadow-none">
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
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.firstName && hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.lastName
                            ? `${hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.firstName} ${hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.lastName} (${hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.username})`
                            : hiringManagers.find((hm) => hm.id.toString() === hiringManagerId)?.username || "-"}
                        </div>
                      )}
                    </div>

                    <div>
                      <Label className="mb-2 flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                        Client
                      </Label>
                      {isEditing ? (
                        <Select
                          value={clientId || "__none__"}
                          onValueChange={(val) => setClientId(val === "__none__" ? "" : val)}
                        >
                          <SelectTrigger className="border-[#E6EAF0] bg-white shadow-none">
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
                      ) : (
                        <div
                          className="cursor-pointer rounded-lg border border-[#E6EAF0] bg-white px-3 py-2 text-sm text-foreground"
                          onClick={() => setIsEditing(true)}
                        >
                          {clients.find((client) => client.id.toString() === clientId)?.name || "-"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-between border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={
                currentStep === 1
                  ? () => setLocation("/my-jobs")
                  : currentStep === 4
                    ? isEditing
                      ? () => setIsEditing(false)
                      : handlePrevious
                    : handlePrevious
              }
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              {currentStep === 1 ? "Cancel" : currentStep === 4 && isEditing ? "Save Changes" : "Previous"}
            </Button>

            {currentStep < 4 ? (
              <Button type="button" onClick={() => void handleNext()} disabled={isExtracting}>
                {currentStep === 1 && isExtracting ? "Extracting..." : "Next"}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={jobMutation.isPending}
                className="bg-success hover:bg-success/80"
              >
                {jobMutation.isPending ? "Posting..." : "Post Job"}
                <Check className="ml-2 h-4 w-4" />
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
          clearGeneratedState();
          setShowAiDrawer(false);
        }}
      />
    </div>
  );
}
