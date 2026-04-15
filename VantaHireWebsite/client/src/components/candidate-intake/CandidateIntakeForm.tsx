import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { fetchWithCsrf } from "@/lib/csrf";
import type { PipelineStage } from "@shared/schema";
import {
  User,
  Briefcase,
  GraduationCap,
  Sparkles,
  FileText,
  StickyNote,
  Check,
  Circle,
  Lock,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type Section,
  type SectionStatus,
  type CandidateIntakeData,
  contactSchema,
  defaultIntakeData,
} from "./types";
import { ContactSection } from "./ContactSection";
import { ExperienceSection } from "./ExperienceSection";
import { EducationSection } from "./EducationSection";
import { SkillsSection } from "./SkillsSection";
import { DocumentsSection } from "./DocumentsSection";
import { NotesSection } from "./NotesSection";

interface CandidateIntakeFormProps {
  jobId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
}

const SECTIONS: Omit<Section, "status">[] = [
  { id: "contact", label: "Contact", required: true },
  { id: "experience", label: "Experience", required: false },
  { id: "education", label: "Education", required: false },
  { id: "skills", label: "Skills", required: false },
  { id: "documents", label: "Documents", required: true },
  { id: "notes", label: "Notes", required: false },
];

const SECTION_ICONS: Record<string, React.ElementType> = {
  contact: User,
  experience: Briefcase,
  education: GraduationCap,
  skills: Sparkles,
  documents: FileText,
  notes: StickyNote,
};

export function CandidateIntakeForm({
  jobId,
  open,
  onOpenChange,
  onSubmitted,
}: CandidateIntakeFormProps) {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("contact");
  const [formData, setFormData] = useState<CandidateIntakeData>(defaultIntakeData);
  const [sectionValidation, setSectionValidation] = useState<Record<string, boolean>>({
    contact: false,
    experience: true, // Optional sections start valid
    education: true,
    skills: true,
    documents: false,
    notes: true,
  });

  // Fetch pipeline stages
  const { data: pipelineStages = [] } = useQuery<PipelineStage[]>({
    queryKey: ["/api/pipeline/stages"],
    queryFn: async () => {
      const response = await fetch("/api/pipeline/stages");
      if (!response.ok) throw new Error("Failed to fetch pipeline stages");
      return response.json();
    },
  });

  // Calculate section statuses based on validation and progressive disclosure
  const sectionStatuses = useMemo((): Record<string, SectionStatus> => {
    const contactValid = sectionValidation.contact;

    return {
      contact: sectionValidation.contact ? "complete" : "incomplete",
      experience: !contactValid ? "locked" : sectionValidation.experience ? "complete" : "incomplete",
      education: !contactValid ? "locked" : sectionValidation.education ? "complete" : "incomplete",
      skills: !contactValid ? "locked" : sectionValidation.skills ? "complete" : "incomplete",
      documents: !contactValid ? "locked" : sectionValidation.documents ? "complete" : "incomplete",
      notes: !contactValid ? "locked" : sectionValidation.notes ? "complete" : "incomplete",
    };
  }, [sectionValidation]);

  // Update section data
  const updateSectionData = useCallback(<K extends keyof CandidateIntakeData>(
    section: K,
    data: CandidateIntakeData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [section]: data }));
  }, []);

  // Mark section as validated
  const setSectionValid = useCallback((section: string, isValid: boolean) => {
    setSectionValidation((prev) => ({ ...prev, [section]: isValid }));
  }, []);

  // Navigate to section (respecting locks)
  const goToSection = useCallback((sectionId: string) => {
    if (sectionStatuses[sectionId] !== "locked") {
      setActiveSection(sectionId);
    }
  }, [sectionStatuses]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      // Validate required sections
      if (!sectionValidation.contact) {
        throw new Error("Please complete the Contact section");
      }
      if (!sectionValidation.documents && !formData.documents.resumeFile) {
        throw new Error("Please upload a resume in the Documents section");
      }

      const multipart = new FormData();

      // Build name from first + last
      const fullName = `${formData.contact.firstName} ${formData.contact.lastName}`.trim();
      multipart.append("name", fullName);
      multipart.append("email", formData.contact.email);
      multipart.append("phone", formData.contact.phone || "");

      // Cover letter from documents
      if (formData.documents.coverLetter) {
        multipart.append("coverLetter", formData.documents.coverLetter);
      }

      // Source and metadata from notes
      multipart.append("source", formData.notes.source);
      if (formData.notes.referrer || formData.notes.internalNotes) {
        const sourceMetadata = {
          referrer: formData.notes.referrer || undefined,
          notes: formData.notes.internalNotes || undefined,
        };
        multipart.append("sourceMetadata", JSON.stringify(sourceMetadata));
      }

      // Initial stage
      if (formData.notes.initialStageId) {
        multipart.append("currentStage", formData.notes.initialStageId.toString());
      }

      // Resume file (required)
      if (formData.documents.resumeFile) {
        multipart.append("resume", formData.documents.resumeFile);
      }

      const res = await fetchWithCsrf(`/api/jobs/${jobId}/applications/recruiter-add`, {
        method: "POST",
        body: multipart,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || error.error || "Failed to add candidate");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs", jobId, "applications"] });
      toast({
        title: "Candidate Added",
        description: "Application created successfully.",
      });
      onOpenChange(false);
      setFormData(defaultIntakeData);
      setSectionValidation({
        contact: false,
        experience: true,
        education: true,
        skills: true,
        documents: false,
        notes: true,
      });
      setActiveSection("contact");
      onSubmitted?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Candidate",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Check if form can be submitted
  const canSubmit = sectionValidation.contact &&
    (sectionValidation.documents || !!formData.documents.resumeFile);

  // Get status icon for nav
  const getStatusIcon = (status: SectionStatus) => {
    switch (status) {
      case "complete":
        return <Check className="h-3 w-3 text-success" />;
      case "incomplete":
        return <Circle className="h-3 w-3 text-muted-foreground" />;
      case "locked":
        return <Lock className="h-3 w-3 text-muted-foreground/50" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-destructive" />;
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl p-0 flex flex-col">
        <SheetHeader className="px-6 py-4 border-b border-border">
          <SheetTitle className="text-foreground">Add Candidate</SheetTitle>
          <SheetDescription>
            Create a new application for this job posting
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation */}
          <nav className="w-48 border-r border-border bg-muted/50 p-4 space-y-1 shrink-0">
            {SECTIONS.map((section) => {
              const Icon = SECTION_ICONS[section.id];
              const status = sectionStatuses[section.id] ?? "incomplete";
              const isActive = activeSection === section.id;
              const isLocked = status === "locked";

              if (!Icon) return null;

              return (
                <button
                  key={section.id}
                  onClick={() => goToSection(section.id)}
                  disabled={isLocked}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors",
                    isActive
                      ? "bg-primary text-white"
                      : isLocked
                      ? "text-muted-foreground/50 cursor-not-allowed"
                      : "text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{section.label}</span>
                  {!isActive && (
                    <span className="shrink-0">{getStatusIcon(status)}</span>
                  )}
                  {section.required && !isActive && status !== "complete" && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-white">
                      Required
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSection === "contact" && (
              <ContactSection
                data={formData.contact}
                onChange={(data) => updateSectionData("contact", data)}
                onValidChange={(isValid) => setSectionValid("contact", isValid)}
                onContinue={() => goToSection("experience")}
              />
            )}
            {activeSection === "experience" && (
              <ExperienceSection
                data={formData.experience}
                onChange={(data) => updateSectionData("experience", data)}
                onValidChange={(isValid) => setSectionValid("experience", isValid)}
                onContinue={() => goToSection("education")}
              />
            )}
            {activeSection === "education" && (
              <EducationSection
                data={formData.education}
                onChange={(data) => updateSectionData("education", data)}
                onValidChange={(isValid) => setSectionValid("education", isValid)}
                onContinue={() => goToSection("skills")}
              />
            )}
            {activeSection === "skills" && (
              <SkillsSection
                data={formData.skills}
                onChange={(data) => updateSectionData("skills", data)}
                onValidChange={(isValid) => setSectionValid("skills", isValid)}
                onContinue={() => goToSection("documents")}
              />
            )}
            {activeSection === "documents" && (
              <DocumentsSection
                data={formData.documents}
                onChange={(data) => updateSectionData("documents", data)}
                onValidChange={(isValid) => setSectionValid("documents", isValid)}
                onContinue={() => goToSection("notes")}
              />
            )}
            {activeSection === "notes" && (
              <NotesSection
                data={formData.notes}
                onChange={(data) => updateSectionData("notes", data)}
                onValidChange={(isValid) => setSectionValid("notes", isValid)}
                pipelineStages={pipelineStages}
              />
            )}
          </div>
        </div>

        {/* Fixed Action Bar */}
        <div className="px-6 py-4 border-t border-border bg-white flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button
            onClick={() => submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Add Candidate
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
