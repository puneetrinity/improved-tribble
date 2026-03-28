import { useState } from "react";
import { X, Mail, FileText, MoveRight, Archive, Sparkles, AlertCircle, MessageSquareMore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PipelineStage, EmailTemplate } from "@shared/schema";
import type { FormTemplateDTO } from "@/lib/formsApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  pipelineStages: PipelineStage[];
  emailTemplates: EmailTemplate[];
  formTemplates: FormTemplateDTO[];
  onMoveStage: (stageId: number) => Promise<void>;
  onSendEmails: (templateId: number) => Promise<void>;
  onSendForms: (formId: number, message: string) => Promise<void>;
  onSelectAll: (selected: boolean) => void;
  onClearSelection: () => void;
  onArchiveSelected: () => Promise<void>;
  onRequestHiringManagerReview?: (note: string) => Promise<void>;
  canRequestHiringManagerReview?: boolean;
  hiringManagerReviewDisabledReason?: string | undefined;
  isBulkProcessing: boolean;
  bulkProgress?: { sent: number; total: number };
  // AI Summary props
  onGenerateAISummary?: () => void;
  aiSummaryEnabled?: boolean;
  aiSummaryLimit?: number | undefined;
  aiSummaryToGenerateCount?: number; // Count of apps that will actually be generated (excludes already-summarized)
}

export function BulkActionBar({
  selectedCount,
  totalCount,
  pipelineStages,
  emailTemplates,
  formTemplates,
  onMoveStage,
  onSendEmails,
  onSendForms,
  onSelectAll,
  onClearSelection,
  onArchiveSelected,
  onRequestHiringManagerReview,
  canRequestHiringManagerReview = false,
  hiringManagerReviewDisabledReason,
  isBulkProcessing,
  bulkProgress,
  onGenerateAISummary,
  aiSummaryEnabled,
  aiSummaryLimit,
  aiSummaryToGenerateCount,
}: BulkActionBarProps) {
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [showFormsDialog, setShowFormsDialog] = useState(false);
  const [showArchiveDialog, setShowArchiveDialog] = useState(false);
  const [showHmReviewDialog, setShowHmReviewDialog] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedFormId, setSelectedFormId] = useState<string>("");
  const [formMessage, setFormMessage] = useState("");
  const [hmReviewNote, setHmReviewNote] = useState("");

  // Helper to format template type labels
  const templateTypeLabel = (type: string) => {
    switch (type) {
      case "application_received": return "App Received";
      case "interview_invite": return "Interview";
      case "status_update": return "Status Update";
      case "offer_extended": return "Offer";
      case "rejection": return "Rejection";
      default: return "Custom";
    }
  };

  const formatShortDate = (value?: string | Date | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  const hasSelection = selectedCount > 0;
  const allSelected = hasSelection && selectedCount === totalCount;
  const someSelected = hasSelection && selectedCount < totalCount;

  const handleMoveStage = async () => {
    if (!selectedStageId) return;
    await onMoveStage(parseInt(selectedStageId, 10));
    setShowMoveDialog(false);
    setSelectedStageId("");
  };

  const handleSendEmails = async () => {
    if (!selectedTemplateId) return;
    await onSendEmails(parseInt(selectedTemplateId, 10));
    setShowEmailDialog(false);
    setSelectedTemplateId("");
  };

  const handleSendForms = async () => {
    if (!selectedFormId) return;
    await onSendForms(parseInt(selectedFormId, 10), formMessage);
    setShowFormsDialog(false);
    setSelectedFormId("");
    setFormMessage("");
  };

  const handleRequestHmReview = async () => {
    if (!onRequestHiringManagerReview) return;
    await onRequestHiringManagerReview(hmReviewNote);
    setShowHmReviewDialog(false);
    setHmReviewNote("");
  };

  const progressPercentage =
    bulkProgress && bulkProgress.total > 0
      ? (bulkProgress.sent / bulkProgress.total) * 100
      : 0;

  return (
    <>
      <div
        className="border border-[#d9d8ff] bg-white px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)] md:px-6"
        role="toolbar"
        aria-label="Bulk actions"
      >
        <div className="flex flex-wrap items-center gap-4">
          {/* Select All Checkbox */}
          <div
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={someSelected ? "indeterminate" : allSelected}
              onCheckedChange={(checked) => onSelectAll(!!checked)}
              aria-label="Select all applications"
              disabled={isBulkProcessing || totalCount === 0}
            />
            <span className={cn(
              "text-sm",
              hasSelection ? "text-foreground font-medium" : "text-muted-foreground"
            )}>
              {hasSelection ? `${selectedCount} selected` : "Select all"}
            </span>
          </div>

          <div className="hidden h-6 w-px bg-border md:block" />

          {/* Action Buttons */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={hasSelection ? "default" : "ghost"}
              className="rounded-none"
              onClick={() => setShowMoveDialog(true)}
              disabled={isBulkProcessing || !hasSelection}
            >
              <MoveRight className="h-4 w-4 mr-2" />
              Move Stage
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="rounded-none"
              onClick={() => setShowEmailDialog(true)}
              disabled={isBulkProcessing || !hasSelection || emailTemplates.length === 0}
            >
              <Mail className="h-4 w-4 mr-2" />
              Email
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="rounded-none"
              onClick={() => setShowFormsDialog(true)}
              disabled={isBulkProcessing || !hasSelection || formTemplates.length === 0}
            >
              <FileText className="h-4 w-4 mr-2" />
              Form
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="rounded-none"
              onClick={() => setShowHmReviewDialog(true)}
              disabled={isBulkProcessing || !hasSelection || !canRequestHiringManagerReview || !onRequestHiringManagerReview}
              title={!canRequestHiringManagerReview ? hiringManagerReviewDisabledReason : undefined}
            >
              <MessageSquareMore className="h-4 w-4 mr-2" />
              Request HM Review
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className="rounded-none text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowArchiveDialog(true)}
              disabled={isBulkProcessing || !hasSelection}
            >
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </Button>

            {/* AI Summary Button */}
            {aiSummaryEnabled && (
              <Button
                size="sm"
                variant="ghost"
                className="rounded-none text-primary hover:bg-primary/10 hover:text-primary"
                onClick={onGenerateAISummary}
                disabled={isBulkProcessing || !hasSelection || selectedCount > 50}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                AI Summary
              </Button>
            )}

            {/* Inline Warning: Max 50 selection exceeded */}
            {selectedCount > 50 && (
              <div className="ml-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Select max 50 for AI Summary ({selectedCount} selected)</span>
              </div>
            )}

            {/* Inline Warning: Rate limit warning (when to-generate count exceeds limit) */}
            {aiSummaryEnabled && aiSummaryLimit !== undefined && aiSummaryToGenerateCount !== undefined && aiSummaryToGenerateCount > 0 && selectedCount <= 50 && aiSummaryToGenerateCount > aiSummaryLimit && (
              <div className="ml-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>Only {aiSummaryLimit} AI summaries left today ({aiSummaryToGenerateCount} needed)</span>
              </div>
            )}
          </div>

          {/* Progress indicator */}
          {isBulkProcessing && bulkProgress && bulkProgress.total > 0 && (
            <div
              className="flex min-w-[180px] items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <Progress value={progressPercentage} className="h-2" />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {bulkProgress.sent}/{bulkProgress.total}
              </span>
            </div>
          )}

          {/* Clear Selection */}
          {hasSelection && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-none text-muted-foreground hover:text-foreground"
              onClick={onClearSelection}
              disabled={isBulkProcessing}
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Move Stage Dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move Selected Applications</DialogTitle>
            <DialogDescription>
              Choose a new stage for the selected applications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedStageId} onValueChange={setSelectedStageId}>
              <SelectTrigger>
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {pipelineStages.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id.toString()}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleMoveStage} disabled={!selectedStageId}>
              Move Applications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showHmReviewDialog} onOpenChange={setShowHmReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Hiring Manager Review</DialogTitle>
            <DialogDescription>
              Send the selected candidates to the assigned hiring manager for evaluation. They will be able to review resumes and leave structured feedback, but not move candidates through the pipeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              {selectedCount} selected candidate{selectedCount === 1 ? "" : "s"} will appear in the hiring manager review queue.
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="hm-review-note">
                Note for hiring manager (optional)
              </label>
              <Textarea
                id="hm-review-note"
                value={hmReviewNote}
                onChange={(event) => setHmReviewNote(event.target.value)}
                placeholder="Highlight what you want the hiring manager to assess for this shortlist..."
                maxLength={1000}
                className="min-h-[120px]"
              />
              <p className="text-xs text-muted-foreground">{hmReviewNote.length}/1000 characters</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHmReviewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleRequestHmReview} disabled={!canRequestHiringManagerReview || !onRequestHiringManagerReview}>
              Send Review Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Email Dialog */}
      <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Email to {selectedCount} Candidates</DialogTitle>
            <DialogDescription>
              Select an email template to send to the selected applications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {emailTemplates
                  .sort((a, b) => {
                    // Sort defaults first
                    if (a.isDefault && !b.isDefault) return -1;
                    if (!a.isDefault && b.isDefault) return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((template) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      <div className="flex max-w-[280px] flex-col items-start gap-1 py-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{template.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {templateTypeLabel(template.templateType)}
                          </span>
                          {template.isDefault && (
                            <span className="text-xs font-medium text-success">Default</span>
                          )}
                          {formatShortDate(template.createdAt) && (
                            <span className="text-xs text-muted-foreground">
                              Created {formatShortDate(template.createdAt)}
                            </span>
                          )}
                        </div>
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {template.subject}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {/* Template Preview */}
            {selectedTemplateId && (() => {
              const template = emailTemplates.find(t => t.id === parseInt(selectedTemplateId));
              if (!template) return null;
              const firstLine = template.body.split('\n')[0];
              return (
                <div className="p-3 bg-muted/50 border border-border rounded-md space-y-1">
                  <p className="text-xs font-medium text-foreground">Preview:</p>
                  <p className="text-sm text-foreground font-medium">{template.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{firstLine || template.body.substring(0, 80)}...</p>
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEmailDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendEmails}
              disabled={!selectedTemplateId}
            >
              Send Emails
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Forms Dialog */}
      <Dialog open={showFormsDialog} onOpenChange={setShowFormsDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Invite {selectedCount} Candidates to Form</DialogTitle>
            <DialogDescription>
              Select a form template to send invitations to the selected
              applications.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedFormId} onValueChange={setSelectedFormId}>
              <SelectTrigger>
                <SelectValue placeholder="Select form" />
              </SelectTrigger>
              <SelectContent>
                {formTemplates.map((form) => (
                  <SelectItem key={form.id} value={form.id.toString()}>
                    <div className="flex max-w-[280px] flex-col items-start gap-1 py-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{form.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {form.fields.length} fields
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {form.isPublished ? "Published" : "Draft"}
                        </span>
                        {formatShortDate(form.updatedAt) && (
                          <span className="text-xs text-muted-foreground">
                            Updated {formatShortDate(form.updatedAt)}
                          </span>
                        )}
                      </div>
                      {form.description && (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {form.description}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                Custom message (optional)
              </label>
              <textarea
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                placeholder="Add a personalized message..."
                className="w-full min-h-[80px] rounded-md border border-border bg-white p-2 text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowFormsDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSendForms}
              disabled={!selectedFormId}
            >
              Send Invitations
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive Confirmation Dialog */}
      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {selectedCount} Applications?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the selected applications. They will be hidden from the
              active pipeline but can be restored later from the archive view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await onArchiveSelected();
                setShowArchiveDialog(false);
              }}
              className="bg-destructive hover:bg-destructive/80"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
