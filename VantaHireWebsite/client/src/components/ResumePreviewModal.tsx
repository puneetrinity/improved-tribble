import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Download, ExternalLink, FileText, AlertCircle, CheckCircle, XCircle } from "lucide-react";

interface ResumePreviewModalProps {
  applicationId: number | null;
  applicationName: string;
  applicationEmail: string;
  jobTitle?: string | undefined;
  resumeUrl: string | null;
  resumeFilename?: string | null;
  status?: string | undefined;
  resumeText?: string | null;
  open: boolean;
  onClose: () => void;
  onDownload?: () => void;
  onMoveToScreening?: (notes: string) => void;
  onReject?: (notes: string) => void;
}

export function ResumePreviewModal({
  applicationId,
  applicationName,
  applicationEmail,
  jobTitle,
  resumeUrl,
  resumeFilename,
  status,
  resumeText,
  open,
  onClose,
  onDownload,
  onMoveToScreening,
  onReject,
}: ResumePreviewModalProps) {
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!applicationId) return null;

  const previewUrl = resumeUrl
    ? `/api/applications/${applicationId}/resume`
    : null;
  const downloadUrl = resumeUrl
    ? `/api/applications/${applicationId}/resume?download=1`
    : null;

  // Check if resume is a PDF
  const nameForType = (resumeFilename || resumeUrl || '').toLowerCase();
  const isPdf = nameForType.endsWith('.pdf') || nameForType.includes('.pdf');

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    }
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
    }
  };

  const handleMoveToScreening = async () => {
    if (onMoveToScreening) {
      setIsSubmitting(true);
      await onMoveToScreening(notes);
      setIsSubmitting(false);
      setNotes("");
      onClose();
    }
  };

  const handleReject = async () => {
    if (onReject) {
      setIsSubmitting(true);
      await onReject(notes);
      setIsSubmitting(false);
      setNotes("");
      onClose();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-warning/10 text-warning-foreground border-warning/30';
      case 'submitted': return 'bg-warning/10 text-warning-foreground border-warning/30';
      case 'reviewed': return 'bg-info/10 text-info-foreground border-info/30';
      case 'shortlisted': return 'bg-success/10 text-success-foreground border-success/30';
      case 'rejected': return 'bg-destructive/10 text-destructive border-destructive/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  const displayFilename = resumeFilename || resumeUrl?.split('/').pop() || 'Resume';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-6xl w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0 flex flex-col">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <DialogTitle className="text-xl font-semibold text-foreground">
                  {applicationName}
                </DialogTitle>
                {status && (
                  <Badge className={getStatusColor(status)}>
                    {status}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">{applicationEmail}</p>
              {jobTitle && (
                <p className="text-sm text-muted-foreground mt-0.5">Applied for: {jobTitle}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Main Content - Two Column Layout */}
        <div className="flex-1 flex overflow-hidden" data-testid="resume-review-modal">
          {/* Left: Resume Preview */}
          <div className="flex-1 flex flex-col border-r border-border">
            {/* Resume Actions Bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-muted/50">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {displayFilename}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {previewUrl && (
                  <>
                    {isPdf && previewUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(previewUrl, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open in New Tab
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownload}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Resume Preview */}
            <div className="flex-1 overflow-hidden p-4" data-testid="resume-preview-pane">
              <div className="h-full border border-border rounded-lg overflow-hidden bg-muted/50" data-testid="resume-preview-frame">
                {previewUrl ? (
                  isPdf ? (
                    <iframe
                      src={`${previewUrl}#toolbar=0&navpanes=0`}
                      className="w-full h-full"
                      title="Resume Preview"
                    />
                  ) : resumeText ? (
                    <div className="h-full p-4 overflow-auto bg-white">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Resume text</p>
                      <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
                        {resumeText}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                      <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
                      <p className="text-muted-foreground mb-4">
                        Unable to preview this file type in browser.
                      </p>
                      <Button onClick={handleDownload}>
                        <Download className="h-4 w-4 mr-2" />
                        Download to View
                      </Button>
                    </div>
                  )
                ) : resumeText ? (
                  <div className="h-full p-4 overflow-auto bg-white">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Resume text</p>
                    <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
                      {resumeText}
                    </pre>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                    <AlertCircle className="h-16 w-16 text-muted-foreground/50 mb-4" />
                    <p className="text-muted-foreground">No resume available for this application</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Review Panel */}
          <div className="w-80 flex flex-col bg-muted/50">
            <div className="p-4 flex-1 overflow-auto">

              {/* Review Notes */}
              <div className="mb-4">
                <label className="text-foreground text-sm font-medium mb-2 block">
                  Review Notes
                </label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this candidate..."
                  className="min-h-[120px] bg-white"
                />
              </div>

              {/* Quick Actions Info */}
              <div className="text-xs text-muted-foreground mb-4">
                <p>Choose an action below to update the candidate's status and move them through the pipeline.</p>
              </div>
            </div>

            {/* Action Buttons - Fixed at Bottom */}
            <div className="p-4 border-t border-border bg-white space-y-2">
              <Button
                className="w-full"
                onClick={handleMoveToScreening}
                disabled={isSubmitting}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Move to Screening
              </Button>
              <Button
                variant="destructive"
                className="w-full"
                onClick={handleReject}
                disabled={isSubmitting}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
