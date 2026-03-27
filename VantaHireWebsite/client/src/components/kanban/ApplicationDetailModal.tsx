import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Application, EmailTemplate, PipelineStage } from "@shared/schema";
import { FormTemplateDTO } from "@/lib/formsApi";
import { ApplicationDetailPanel, type EmailSendPayload } from "./ApplicationDetailPanel";
import { Download, FileText, ExternalLink, AlertCircle, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApplicationDetailModalProps {
  application: Application | null;
  applications?: Application[];
  jobId: number;
  pipelineStages: PipelineStage[];
  emailTemplates: EmailTemplate[];
  formTemplates: FormTemplateDTO[];
  stageHistory: any[];
  resumeText?: string | null;
  open: boolean;
  onClose: () => void;
  onSelectApplication?: (application: Application) => void;
  onMoveStage: (stageId: number, notes?: string) => void;
  onScheduleInterview: (data: { date: string; time: string; location: string; notes: string }) => void;
  onSendEmail: (payload: EmailSendPayload) => void;
  onSendForm: (formId: number, message: string) => void;
  onAddNote: (note: string) => void;
  onSetRating: (rating: number) => void;
  onDownloadResume: () => void;
  onUpdateStatus?: (status: string, notes?: string) => void;
}

export function ApplicationDetailModal({
  application,
  applications = [],
  jobId,
  pipelineStages,
  emailTemplates,
  formTemplates,
  stageHistory,
  resumeText,
  open,
  onClose,
  onSelectApplication,
  onMoveStage,
  onScheduleInterview,
  onSendEmail,
  onSendForm,
  onAddNote,
  onSetRating,
  onDownloadResume,
  onUpdateStatus,
}: ApplicationDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"details" | "resume">("details");

  if (!application) return null;

  const resumeUrl = application.resumeUrl
    ? `/api/applications/${application.id}/resume`
    : null;
  // Check if resume is a PDF (most likely case)
  const nameForType = (application.resumeFilename || application.resumeUrl || '').toLowerCase();
  const isPdf = nameForType.endsWith('.pdf') || nameForType.includes('.pdf');
  const displayFilename = application.resumeFilename || application.resumeUrl?.split('/').pop() || 'Resume';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[90vh] w-[92vw] max-w-[1360px] flex-col gap-0 overflow-hidden p-0" aria-describedby={undefined}>
        <DialogHeader className="sr-only">
          <DialogTitle>Candidate application details</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <aside className="hidden w-[340px] shrink-0 border-r border-border bg-slate-50/60 md:flex md:flex-col">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-medium text-foreground">Candidates</p>
                <p className="text-xs text-muted-foreground">
                  {applications.length} candidate{applications.length === 1 ? "" : "s"} in this view
                </p>
              </div>
              <ScrollArea className="flex-1">
                <div className="px-4 py-3">
                  {applications.length > 0 ? (
                    <div className="space-y-2">
                      {applications.map((candidate) => (
                        <button
                          key={candidate.id}
                          type="button"
                          onClick={() => onSelectApplication?.(candidate)}
                          className={cn(
                            "w-full border px-3 py-3 text-left transition-colors",
                            candidate.id === application.id
                              ? "border-primary bg-primary/5"
                              : "border-border bg-white hover:bg-muted/40",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-foreground">{candidate.name}</p>
                              <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                                <div className="flex items-center gap-1">
                                  <Mail className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{candidate.email}</span>
                                </div>
                                {candidate.phone && (
                                  <div className="flex items-center gap-1">
                                    <Phone className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{candidate.phone}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <Badge variant="outline" className="shrink-0 border-info/30 bg-info/10 text-info-foreground">
                              {candidate.status}
                            </Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                      No candidates available
                    </div>
                  )}
                </div>
              </ScrollArea>
          </aside>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "details" | "resume")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center justify-center border-b border-border px-8 py-5">
              <TabsList className="grid w-full max-w-2xl grid-cols-2 rounded-none bg-muted/50 p-1">
                <TabsTrigger value="details" className="h-11 rounded-none text-base">
                  <FileText className="mr-2 h-4 w-4" />
                  Application Details
                </TabsTrigger>
                <TabsTrigger value="resume" disabled={!resumeUrl} className="h-11 rounded-none text-base">
                  <FileText className="mr-2 h-4 w-4" />
                  Resume Preview
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden border-t border-border">
              <TabsContent value="details" className="mt-0 h-full">
                <ScrollArea className="h-full">
                  <ApplicationDetailPanel
                    application={application}
                    jobId={jobId}
                    pipelineStages={pipelineStages}
                    emailTemplates={emailTemplates}
                    formTemplates={formTemplates}
                    stageHistory={stageHistory}
                    onClose={onClose}
                    onMoveStage={onMoveStage}
                    onScheduleInterview={onScheduleInterview}
                    onSendEmail={onSendEmail}
                    onSendForm={onSendForm}
                    onAddNote={onAddNote}
                    onSetRating={onSetRating}
                    onDownloadResume={onDownloadResume}
                    embedded
                    {...(onUpdateStatus ? { onUpdateStatus } : {})}
                  />
                </ScrollArea>
              </TabsContent>

              <TabsContent value="resume" className="mt-0 h-full">
                <div className="h-full flex flex-col p-6">
              {/* Resume Actions Bar */}
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {displayFilename}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isPdf && resumeUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(resumeUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open in New Tab
                    </Button>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    onClick={onDownloadResume}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>

              {/* Resume Preview */}
              <div className="flex-1 border border-border rounded-lg overflow-hidden bg-muted/50">
                {resumeUrl ? (
                  isPdf ? (
                    <iframe
                      src={`${resumeUrl}#toolbar=0&navpanes=0`}
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
                      <Button onClick={onDownloadResume}>
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
                    <p className="text-muted-foreground">No resume available</p>
                  </div>
                )}
              </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
