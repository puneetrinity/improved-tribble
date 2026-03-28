import { useState, useEffect } from "react";
import { X, Mail, Phone, Calendar, Clock, MapPin, Download, FileText, History as HistoryIcon, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Application, EmailTemplate, PipelineStage } from "@shared/schema";
import { FormTemplateDTO } from "@/lib/formsApi";
import { AISummaryPanel } from "@/components/AISummaryPanel";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { ClientFeedbackList } from "@/components/ClientFeedbackList";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAiCreditExhaustionToast } from "@/hooks/use-ai-credit-exhaustion";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// Email history entry type
interface EmailHistoryEntry {
  id: number;
  templateName: string;
  templateType: string;
  sentAt: string;
  recipientEmail: string;
  status: string;
  sentBy: { firstName: string; lastName: string } | null;
}

export interface EmailSendPayload {
  templateId: number;
  subject?: string;
  body?: string;
}

interface ApplicationDetailPanelProps {
  application: Application;
  jobId: number;
  pipelineStages: PipelineStage[];
  emailTemplates: EmailTemplate[];
  formTemplates: FormTemplateDTO[];
  stageHistory: any[];
  onClose: () => void;
  onMoveStage: (stageId: number, notes?: string) => void;
  onScheduleInterview: (data: { date: string; time: string; location: string; notes: string }) => void;
  onSendEmail: (payload: EmailSendPayload) => void;
  onSendForm: (formId: number, message: string) => void;
  onAddNote: (note: string) => void;
  onSetRating: (rating: number) => void;
  onDownloadResume: () => void;
  onUpdateStatus?: (status: string, notes?: string) => void;
  embedded?: boolean;
}

export function ApplicationDetailPanel({
  application,
  jobId,
  pipelineStages,
  emailTemplates,
  formTemplates,
  stageHistory,
  onClose,
  onMoveStage,
  onScheduleInterview,
  onSendEmail,
  onSendForm,
  onAddNote,
  onDownloadResume,
  onUpdateStatus,
  embedded = false,
}: ApplicationDetailPanelProps) {
  const { toast } = useToast();
  const { showAiCreditExhaustionToast } = useAiCreditExhaustionToast();

  // Fetch email history for this application
  const { data: emailHistory = [], isLoading: emailHistoryLoading } = useQuery<EmailHistoryEntry[]>({
    queryKey: ["/api/applications", application.id, "email-history"],
    queryFn: async () => {
      const response = await fetch(`/api/applications/${application.id}/email-history`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const [interviewDate, setInterviewDate] = useState("");
  const [interviewTime, setInterviewTime] = useState("");
  const [interviewLocation, setInterviewLocation] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [selectedFormId, setSelectedFormId] = useState<string>("");
  const [formMessage, setFormMessage] = useState("");

  // AI Email Draft state
  const [emailTone, setEmailTone] = useState<'friendly' | 'formal'>('friendly');
  const [aiDraftSubject, setAiDraftSubject] = useState<string>("");
  const [aiDraftBody, setAiDraftBody] = useState<string>("");
  const [showAiDraft, setShowAiDraft] = useState(false);

  // Smart default template selection based on context
  useEffect(() => {
    if (!selectedTemplateId && emailTemplates.length > 0) {
      // Check current stage to determine appropriate template
      const currentStage = pipelineStages.find(s => s.id === application.currentStage);
      const stageName = currentStage?.name.toLowerCase() || '';

      // Determine template type based on stage and status
      // Check rejection first (status takes priority)
      let targetType: string | null = null;
      if (application.status === 'rejected' || stageName.includes('reject')) {
        targetType = 'rejection';
      } else if (stageName.includes('interview') || stageName.includes('screening')) {
        targetType = 'interview_invite';
      } else if (stageName.includes('offer')) {
        targetType = 'offer_extended';
      }

      // Find default template of target type
      if (targetType) {
        const defaultTemplate = emailTemplates.find(
          t => t.templateType === targetType && t.isDefault
        );
        if (defaultTemplate) {
          setSelectedTemplateId(defaultTemplate.id.toString());
        }
      }
    }
  }, [emailTemplates, application.currentStage, application.status, pipelineStages, selectedTemplateId]);

  // AI Email Draft mutation
  const generateEmailDraftMutation = useMutation({
    mutationFn: async ({ templateId, tone }: { templateId: number; tone: 'friendly' | 'formal' }) => {
      const res = await apiRequest("POST", "/api/email/draft", {
        templateId,
        applicationId: application.id,
        tone,
      });
      return await res.json();
    },
    onSuccess: (data: { subject: string; body: string }) => {
      setAiDraftSubject(data.subject);
      setAiDraftBody(data.body);
      setShowAiDraft(true);
      toast({
        title: "AI Draft Generated",
        description: "Email has been personalized with AI. Review before sending.",
      });
    },
    onError: (error: Error) => {
      if (showAiCreditExhaustionToast(error)) {
        return;
      }
      const is429 = error.message.includes("429");
      toast({
        title: is429 ? "AI limit reached" : "AI draft failed",
        description: is429
          ? "You've reached today's AI email limit. Please try again tomorrow."
          : error.message,
        variant: "destructive",
      });
    },
  });

  const handleScheduleInterview = () => {
    if (!interviewDate || !interviewTime || !interviewLocation) return;
    onScheduleInterview({
      date: interviewDate,
      time: interviewTime,
      location: interviewLocation,
      notes: interviewNotes,
    });
    setInterviewDate("");
    setInterviewTime("");
    setInterviewLocation("");
    setInterviewNotes("");
  };

  const handleGenerateAIDraft = () => {
    if (!selectedTemplateId) {
      toast({
        title: "No template selected",
        description: "Please select an email template first.",
        variant: "destructive",
      });
      return;
    }
    generateEmailDraftMutation.mutate({
      templateId: parseInt(selectedTemplateId),
      tone: emailTone,
    });
  };

  const handleSendEmail = () => {
    if (!selectedTemplateId) return;
    onSendEmail({
      templateId: parseInt(selectedTemplateId, 10),
      ...(showAiDraft && aiDraftSubject && aiDraftBody
        ? {
            subject: aiDraftSubject,
            body: aiDraftBody,
          }
        : {}),
    });
    setSelectedTemplateId("");
    setShowAiDraft(false);
    setAiDraftSubject("");
    setAiDraftBody("");
  };

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

  const handleSendForm = () => {
    if (!selectedFormId) return;
    onSendForm(parseInt(selectedFormId), formMessage);
    setSelectedFormId("");
    setFormMessage("");
  };

  const currentStage = pipelineStages.find((s) => s.id === application.currentStage);
  const selectedTemplate = selectedTemplateId
    ? emailTemplates.find((t) => t.id === parseInt(selectedTemplateId, 10))
    : undefined;
  const selectedForm = selectedFormId
    ? formTemplates.find((f) => f.id === parseInt(selectedFormId, 10))
    : undefined;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className={embedded ? "flex-1 overflow-y-auto p-6" : "flex-1 overflow-y-auto p-4"}>
        <Tabs defaultValue="summary" className="w-full">
          <TabsList className="flex w-full overflow-x-auto gap-2 whitespace-nowrap">
            <TabsTrigger className="min-w-[88px]" value="summary">Summary</TabsTrigger>
            <TabsTrigger className="min-w-[96px]" value="feedback">Feedback</TabsTrigger>
            <TabsTrigger className="min-w-[88px]" value="history">History</TabsTrigger>
            <TabsTrigger className="min-w-[72px]" value="emails">Emails</TabsTrigger>
            <TabsTrigger className="min-w-[104px]" value="interview">Interview</TabsTrigger>
          </TabsList>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-4">
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-lg">{application.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Mail className="h-4 w-4 text-primary" />
                    <span className="text-sm">{application.email}</span>
                  </div>
                  {application.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4 text-primary" />
                      <span className="text-sm">{application.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      Applied {new Date(application.appliedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="border-info/30 text-info-foreground bg-info/10">
                    {application.status}
                  </Badge>
                  {currentStage && (
                    <Badge variant="outline" className="border-primary/30 text-primary bg-primary/10">
                      {currentStage.name}
                    </Badge>
                  )}
                  {application.interviewDate && (
                    <Badge variant="outline" className="border-success/30 text-success-foreground bg-success/10">
                      Interview Scheduled
                    </Badge>
                  )}
                </div>

                <Button
                  onClick={onDownloadResume}
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Resume
                </Button>

                <div className="pt-4 border-t border-border">
                  <AISummaryPanel
                    applicationId={application.id}
                    jobId={jobId}
                    aiSummary={application.aiSummary}
                    aiSuggestedAction={application.aiSuggestedAction}
                    aiSuggestedActionReason={application.aiSuggestedActionReason}
                    aiSummaryComputedAt={application.aiSummaryComputedAt}
                    pipelineStages={pipelineStages}
                    currentStageId={application.currentStage}
                    onMoveStage={onMoveStage}
                    onAddNote={onAddNote}
                    onUpdateStatus={onUpdateStatus}
                  />
                </div>

                {/* Send Form */}
                {formTemplates.length > 0 && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <div className="space-y-1">
                      <Label className="text-foreground">Invite to Form</Label>
                      <p className="text-sm text-muted-foreground">
                        Select a form to send and add an optional message for the candidate.
                      </p>
                    </div>
                    <Select value={selectedFormId} onValueChange={setSelectedFormId}>
                      <SelectTrigger className="bg-white border-border">
                        <SelectValue placeholder="Select form" />
                      </SelectTrigger>
                      <SelectContent>
                        {formTemplates.map((form) => (
                          <SelectItem key={form.id} value={form.id.toString()}>
                            <span className="block max-w-[280px] truncate font-medium">
                              {form.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {selectedForm && (
                      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{selectedForm.name}</p>
                              <Badge variant="outline" className="text-xs">
                                {selectedForm.fields.length} fields
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {selectedForm.isPublished ? "Published" : "Draft"}
                              </Badge>
                            </div>
                            {selectedForm.description && (
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {selectedForm.description}
                              </p>
                            )}
                            {formatShortDate(selectedForm.updatedAt) && (
                              <p className="text-xs text-muted-foreground">
                                Updated {formatShortDate(selectedForm.updatedAt)}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-foreground text-sm">Optional message</Label>
                          <Textarea
                            placeholder="Add context for the candidate before sending the form invitation"
                            value={formMessage}
                            onChange={(e) => setFormMessage(e.target.value)}
                            className="bg-white border-border placeholder:text-muted-foreground min-h-[96px]"
                          />
                        </div>
                        <Button
                          onClick={handleSendForm}
                          disabled={!selectedFormId}
                          variant="outline"
                          className="w-full border-border text-foreground hover:bg-muted"
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          Send Invitation
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Feedback Tab */}
          <TabsContent value="feedback" className="space-y-4">
            <FeedbackPanel applicationId={application.id} jobId={jobId} canAdd={true} />
            <ClientFeedbackList applicationId={application.id} />
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-3">
            {stageHistory.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No history available</p>
            ) : (
              stageHistory.map((entry: any, index: number) => (
                <Card key={`${entry.timestamp ?? "history"}-${entry.action ?? index}-${index}`} className="bg-muted/50 border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <HistoryIcon className="h-4 w-4 text-primary mt-1" />
                      <div className="flex-1">
                        <p className="text-foreground text-sm font-medium">{entry.action}</p>
                        <p className="text-muted-foreground text-xs mt-1">
                          {new Date(entry.timestamp).toLocaleString()}
                        </p>
                        {entry.notes && (
                          <p className="text-muted-foreground text-sm mt-2">{entry.notes}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Emails Tab */}
          <TabsContent value="emails" className="space-y-3">
            {emailTemplates.length > 0 && (
              <Card className="bg-muted/50 border-border">
                <CardContent className="space-y-4 p-4">
                  <div className="space-y-1">
                    <Label className="text-foreground">Send Email</Label>
                    <p className="text-sm text-muted-foreground">
                      Choose a template, review it, then optionally personalize it with AI before sending.
                    </p>
                  </div>

                  <Select value={selectedTemplateId} onValueChange={(value) => {
                    setSelectedTemplateId(value);
                    setShowAiDraft(false);
                  }}>
                    <SelectTrigger className="bg-white border-border">
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailTemplates
                        .sort((a, b) => {
                          if (a.isDefault && !b.isDefault) return -1;
                          if (!a.isDefault && b.isDefault) return 1;
                          return a.name.localeCompare(b.name);
                        })
                        .map((template) => (
                          <SelectItem key={template.id} value={template.id.toString()}>
                            <span className="block max-w-[280px] truncate font-medium">
                              {template.name}
                            </span>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>

                  {selectedTemplate && (
                    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-4">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{selectedTemplate.name}</p>
                              <Badge variant="outline" className="text-xs">
                                {templateTypeLabel(selectedTemplate.templateType)}
                              </Badge>
                              {selectedTemplate.isDefault && (
                                <Badge variant="outline" className="border-success/30 bg-success/10 text-success-foreground text-xs">
                                  Default
                                </Badge>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              {formatShortDate(selectedTemplate.createdAt) && (
                                <span>Created {formatShortDate(selectedTemplate.createdAt)}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-md border border-border bg-white p-3 space-y-2">
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
                            <p className="text-sm font-medium text-foreground break-words">
                              {selectedTemplate.subject}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
                            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3 break-words">
                              {selectedTemplate.body.split('\n').find(line => line.trim()) || selectedTemplate.body.substring(0, 140)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-foreground text-sm">Tone</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={emailTone === 'friendly' ? 'default' : 'outline'}
                            onClick={() => setEmailTone('friendly')}
                            className="w-full"
                          >
                            Friendly
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={emailTone === 'formal' ? 'outline' : 'outline'}
                            onClick={() => setEmailTone('formal')}
                            className={`w-full ${emailTone === 'formal' ? 'border-primary text-primary bg-primary/5 hover:bg-primary/10' : ''}`}
                          >
                            Formal
                          </Button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <Button
                          onClick={handleGenerateAIDraft}
                          disabled={generateEmailDraftMutation.isPending}
                          variant="outline"
                          className="w-full border-primary/30 text-primary hover:bg-primary/10"
                        >
                          {generateEmailDraftMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-4 w-4 mr-2" />
                              Generate with AI
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={handleSendEmail}
                          disabled={!selectedTemplateId}
                          variant="outline"
                          className="w-full border-border text-foreground hover:bg-muted"
                        >
                          <Mail className="h-4 w-4 mr-2" />
                          {showAiDraft && aiDraftSubject && aiDraftBody ? "Send AI Draft" : "Send Email"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {showAiDraft && aiDraftSubject && aiDraftBody && (
                    <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 space-y-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <Label className="text-primary font-medium text-sm">AI-Generated Preview</Label>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</Label>
                          <p className="mt-1 text-sm text-foreground font-medium break-words">{aiDraftSubject}</p>
                        </div>
                        <div>
                          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Body</Label>
                          <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-primary/10 bg-white/70 p-3">
                            <p className="text-sm text-foreground whitespace-pre-wrap">
                              {aiDraftBody}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {emailHistoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : emailHistory.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">No emails sent to this candidate</p>
            ) : (
              emailHistory.map((entry) => (
                <Card key={entry.id} className="bg-muted/50 border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Mail className="h-4 w-4 text-primary mt-1" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-foreground text-sm font-medium">{entry.templateName}</p>
                          <Badge variant="outline" className="text-xs capitalize">
                            {entry.templateType.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground text-xs mt-1">
                          To: {entry.recipientEmail}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {format(new Date(entry.sentAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        {entry.sentBy && (
                          <p className="text-muted-foreground text-xs mt-1">
                            Sent by {entry.sentBy.firstName} {entry.sentBy.lastName}
                          </p>
                        )}
                        <Badge
                          className={`mt-2 text-xs ${
                            entry.status === 'sent' ? 'bg-success/20 text-success-foreground' :
                            entry.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                            'bg-muted text-foreground'
                          }`}
                        >
                          {entry.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Interview Tab */}
          <TabsContent value="interview" className="space-y-3">
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-base">Schedule Interview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-foreground">Date</Label>
                  <Input
                    type="date"
                    value={interviewDate}
                    onChange={(e) => setInterviewDate(e.target.value)}
                    className="bg-white border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Time</Label>
                  <Input
                    type="time"
                    value={interviewTime}
                    onChange={(e) => setInterviewTime(e.target.value)}
                    className="bg-white border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Location</Label>
                  <Input
                    placeholder="Office, Zoom link, etc."
                    value={interviewLocation}
                    onChange={(e) => setInterviewLocation(e.target.value)}
                    className="bg-white border-border placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-foreground">Notes (optional)</Label>
                  <Textarea
                    placeholder="Additional interview details..."
                    value={interviewNotes}
                    onChange={(e) => setInterviewNotes(e.target.value)}
                    className="bg-white border-border placeholder:text-muted-foreground"
                  />
                </div>
                <Button
                  onClick={handleScheduleInterview}
                  disabled={!interviewDate || !interviewTime || !interviewLocation}
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Schedule Interview
                </Button>
              </CardContent>
            </Card>

            {application.interviewDate && (
              <Card className="bg-muted/50 border-border">
                <CardHeader>
                  <CardTitle className="text-foreground text-base">Current Interview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 text-primary" />
                    <span className="text-sm">{new Date(application.interviewDate).toLocaleDateString()}</span>
                  </div>
                  {application.interviewTime && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="text-sm">{application.interviewTime}</span>
                    </div>
                  )}
                  {application.interviewLocation && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4 text-primary" />
                      <span className="text-sm">{application.interviewLocation}</span>
                    </div>
                  )}
                  {application.interviewNotes && (
                    <p className="text-muted-foreground text-sm mt-3">{application.interviewNotes}</p>
                  )}
                  <div className="pt-3 border-t border-border mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        window.open(`/api/applications/${application.id}/interview/ics`, '_blank');
                      }}
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Add to Calendar (.ics)
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      Share with interviewers and candidate
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
