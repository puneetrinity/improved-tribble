import { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronRight,
  Upload,
  FileText,
  X,
  Link as LinkIcon,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type DocumentsData } from "./types";

interface DocumentsSectionProps {
  data: DocumentsData;
  onChange: (data: DocumentsData) => void;
  onValidChange: (isValid: boolean) => void;
  onContinue: () => void;
}

const ACCEPTED_FILE_TYPES = ".pdf,.doc,.docx";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function DocumentsSection({
  data,
  onChange,
  onValidChange,
  onContinue,
}: DocumentsSectionProps) {
  const { toast } = useToast();

  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const validateFile = useCallback((file: File): boolean => {
    const validTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF or Word document",
        variant: "destructive",
      });
      return false;
    }
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File too large",
        description: "File size must be less than 5MB",
        variant: "destructive",
      });
      return false;
    }
    return true;
  }, [toast]);

  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && validateFile(file)) {
        onChange({ ...data, resumeFile: file });
      }
    },
    [data, onChange, validateFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && validateFile(file)) {
        onChange({ ...data, resumeFile: file });
      }
    },
    [data, onChange, validateFile]
  );

  const removeFile = () => {
    onChange({ ...data, resumeFile: null });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Documents</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the candidate's resume and optional supporting documents
        </p>
      </div>

      {/* Resume Upload */}
      <div className="space-y-2">
        <Label>
          Resume <span className="text-destructive">*</span>
        </Label>
        {data.resumeFile ? (
          <Card className="border-success/30 bg-success/10/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-success/20 rounded-lg">
                  <FileText className="h-5 w-5 text-success" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {data.resumeFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(data.resumeFile.size)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={removeFile}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleFileDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              "hover:border-primary hover:bg-primary/5 cursor-pointer"
            )}
            onClick={() => document.getElementById("resume-upload")?.click()}
          >
            <input
              id="resume-upload"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={handleFileSelect}
              className="hidden"
            />
            <Upload className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">
              Drop your resume here or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              PDF or Word document, max 5MB
            </p>
          </div>
        )}
      </div>

      {/* Cover Letter */}
      <div className="space-y-2">
        <Label htmlFor="coverLetter">Cover Letter (Optional)</Label>
        <Textarea
          id="coverLetter"
          value={data.coverLetter}
          onChange={(e) => onChange({ ...data, coverLetter: e.target.value })}
          placeholder="Paste or write a cover letter..."
          rows={5}
        />
        <p className="text-xs text-muted-foreground">
          {(data.coverLetter?.length || 0).toLocaleString()}/5,000 characters
        </p>
      </div>

      {/* Portfolio URL */}
      <div className="space-y-2">
        <Label htmlFor="portfolioUrl" className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-muted-foreground" />
          Portfolio / Website (Optional)
        </Label>
        <Input
          id="portfolioUrl"
          type="url"
          value={data.portfolioUrl}
          onChange={(e) => onChange({ ...data, portfolioUrl: e.target.value })}
          placeholder="https://portfolio.example.com"
        />
      </div>

      <div className="pt-4 flex justify-end">
        <Button onClick={onContinue} disabled={!data.resumeFile}>
          Continue
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
