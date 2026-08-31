import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Plus, Edit, Trash2, Eye, EyeOff, Loader2, Upload, X, Users, AlertTriangle, CheckCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formsApi, formsQueryKeys, type FormTemplateDTO, type InvitationQuotaResponse } from "@/lib/formsApi";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";

// Helper to validate email
const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

export default function AdminFormsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<FormTemplateDTO | null>(null);

  // Bulk invite state
  const [bulkInviteDialogOpen, setBulkInviteDialogOpen] = useState(false);
  const [bulkInviteTemplate, setBulkInviteTemplate] = useState<FormTemplateDTO | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [inviteList, setInviteList] = useState<Array<{ email: string; name: string }>>([]);
  const [bulkInviteProgress, setBulkInviteProgress] = useState<{ sent: number; total: number; results: Array<{ email: string; name: string; status: string }> } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Redirect if not admin or recruiter
  if (user && !['super_admin', 'recruiter'].includes(user.role)) {
    return <Redirect to="/jobs" />;
  }

  // Fetch templates
  const { data: templatesData, isLoading } = useQuery({
    queryKey: formsQueryKeys.templates(),
    queryFn: formsApi.listTemplates,
    enabled: !!user && ['super_admin', 'recruiter'].includes(user.role),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => formsApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.templates() });
      toast({
        title: "Template Deleted",
        description: "Form template has been deleted successfully.",
      });
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Delete Template",
        description: error.message || "Cannot delete template with existing invitations.",
        variant: "destructive",
      });
    },
  });

  // Publish/Unpublish mutation
  const togglePublishMutation = useMutation({
    mutationFn: ({ id, isPublished }: { id: number; isPublished: boolean }) =>
      formsApi.updateTemplate(id, { isPublished }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.templates() });
      toast({
        title: "Template Updated",
        description: "Template publish status has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Update Template",
        description: error.message || "Failed to update template.",
        variant: "destructive",
      });
    },
  });

  // Fetch invitation quota
  const { data: invitationQuota } = useQuery<InvitationQuotaResponse>({
    queryKey: formsQueryKeys.invitationQuota(),
    queryFn: () => formsApi.getInvitationQuota(),
    enabled: bulkInviteDialogOpen,
    staleTime: 30_000,
  });

  // Bulk invite mutation - sends to email addresses directly (with name)
  const bulkInviteMutation = useMutation({
    mutationFn: async ({ templateId, invites }: { templateId: number; invites: Array<{ email: string; name: string }> }) => {
      const results: Array<{ email: string; name: string; status: string; error?: string }> = [];
      setBulkInviteProgress({ sent: 0, total: invites.length, results: [] });

      let sent = 0;
      for (const invite of invites) {
        try {
          await apiRequest("POST", "/api/forms/invitations/external", {
            formId: templateId,
            email: invite.email.trim(),
            candidateName: invite.name.trim(),
          });
          results.push({ email: invite.email, name: invite.name, status: 'sent' });
        } catch (err: any) {
          results.push({ email: invite.email, name: invite.name, status: 'failed', error: err.message });
        }
        sent++;
        setBulkInviteProgress({ sent, total: invites.length, results: [...results] });
      }

      return { results, summary: { total: invites.length, sent: results.filter(r => r.status === 'sent').length, failed: results.filter(r => r.status === 'failed').length } };
    },
    onSuccess: ({ summary }) => {
      queryClient.invalidateQueries({ queryKey: formsQueryKeys.invitationQuota() });
      toast({
        title: "Bulk invitations complete",
        description: `Sent: ${summary.sent}, Failed: ${summary.failed}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Bulk invite failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreateNew = () => {
    navigate("/admin/forms/editor/new");
  };

  const handleEdit = (template: FormTemplateDTO) => {
    navigate(`/admin/forms/editor/${template.id}`);
  };

  const handleDelete = (template: FormTemplateDTO) => {
    setTemplateToDelete(template);
    setDeleteDialogOpen(true);
  };

  const handleTogglePublish = (template: FormTemplateDTO) => {
    togglePublishMutation.mutate({
      id: template.id,
      isPublished: !template.isPublished,
    });
  };

  const canEditTemplate = (template: FormTemplateDTO) => {
    return template.canManage;
  };

  // Bulk invite handlers
  const handleOpenBulkInvite = (template: FormTemplateDTO) => {
    setBulkInviteTemplate(template);
    setNameInput("");
    setEmailInput("");
    setInviteList([]);
    setBulkInviteProgress(null);
    setBulkInviteDialogOpen(true);
  };

  const handleCloseBulkInvite = () => {
    setBulkInviteDialogOpen(false);
    setBulkInviteTemplate(null);
    setNameInput("");
    setEmailInput("");
    setInviteList([]);
    setBulkInviteProgress(null);
  };

  const handleAddInvite = () => {
    const email = emailInput.trim().toLowerCase();
    const name = nameInput.trim();

    if (!email || !isValidEmail(email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    if (!name) {
      toast({
        title: "Name Required",
        description: "Please enter the candidate's name.",
        variant: "destructive",
      });
      return;
    }

    // Check for duplicate email
    if (inviteList.some(i => i.email === email)) {
      toast({
        title: "Duplicate Email",
        description: "This email is already in the list.",
        variant: "destructive",
      });
      return;
    }

    setInviteList([...inviteList, { email, name }]);
    setEmailInput("");
    setNameInput("");
  };

  const handleRemoveInvite = (email: string) => {
    setInviteList(inviteList.filter(i => i.email !== email));
  };

  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split(/[\n]+/).filter(line => line.trim());
      const newInvites: Array<{ email: string; name: string }> = [];

      for (const line of lines) {
        // Support formats: "name,email" or "email,name" or just "email" (name defaults to email prefix)
        const parts = line.split(',').map(p => p.trim());
        let email = '';
        let name = '';

        if (parts.length >= 2) {
          const part0 = parts[0] ?? '';
          const part1 = parts[1] ?? '';
          // Check which part is email
          if (isValidEmail(part0)) {
            email = part0.toLowerCase();
            name = part1;
          } else if (isValidEmail(part1)) {
            name = part0;
            email = part1.toLowerCase();
          }
        } else if (parts.length === 1) {
          const part0 = parts[0] ?? '';
          if (isValidEmail(part0)) {
            email = part0.toLowerCase();
            name = email.split('@')[0] ?? ''; // Use email prefix as name
          }
        }

        if (email && name && !inviteList.some(i => i.email === email) && !newInvites.some(i => i.email === email)) {
          newInvites.push({ email, name });
        }
      }

      if (newInvites.length > 0) {
        setInviteList([...inviteList, ...newInvites]);
        toast({
          title: "CSV Imported",
          description: `Added ${newInvites.length} candidate(s) from CSV`,
        });
      } else {
        toast({
          title: "No Valid Entries",
          description: "No valid name/email pairs found in CSV. Format: name,email (one per line)",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);

    // Reset file input
    if (csvInputRef.current) {
      csvInputRef.current.value = "";
    }
  };

  const handleSendBulkInvites = () => {
    if (!bulkInviteTemplate || inviteList.length === 0) return;
    bulkInviteMutation.mutate({
      templateId: bulkInviteTemplate.id,
      invites: inviteList,
    });
  };

  const templates = templatesData?.templates || [];
  const publishedCount = templates.filter((template) => template.isPublished).length;
  const draftCount = templates.length - publishedCount;

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Candidate Intake"
        title="Form Templates"
        subtitle="Create and manage custom forms to send to candidates"
        icon={FileText}
        actions={
          <Button
            onClick={handleCreateNew}
            data-tour="create-form-button"
            className="h-11 rounded-2xl bg-[#4B8EF0] px-5 font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#3679DB]"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create Template
          </Button>
        }
        stats={[
          { label: "Templates", value: templates.length },
          { label: "Published", value: publishedCount, accentClassName: "text-[#16A34A]" },
          { label: "Drafts", value: draftCount, accentClassName: draftCount > 0 ? "text-[#D97706]" : undefined },
        ]}
      />

      <InternalPanel className="p-5" data-tour="forms-list">
        <InternalSectionHeader
          title="Templates"
          description={
            user?.role === 'super_admin'
              ? 'All form templates (published and drafts)'
              : 'Published templates and your own drafts'
          }
        />
        <div className="mt-5">
          {isLoading ? (
            <InternalEmptyState
              icon={Loader2}
              title="Loading form templates"
              className="[&_svg]:animate-spin"
            />
          ) : templates.length === 0 ? (
            <InternalEmptyState
              icon={FileText}
              title="No templates yet"
              description="Create your first template to get started"
              actions={
                <Button onClick={handleCreateNew}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Template
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-muted/50">
                    <TableHead className="text-muted-foreground">Template Name</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground">Fields</TableHead>
                    <TableHead className="text-muted-foreground">Created By</TableHead>
                    <TableHead className="text-muted-foreground">Updated</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((template) => (
                    <TableRow
                      key={template.id}
                      className="border-border hover:bg-muted/50"
                    >
                      <TableCell>
                        <div>
                          <p className="text-foreground font-medium">{template.name}</p>
                          {template.description && (
                            <p className="text-muted-foreground text-sm mt-1">
                              {template.description.length > 60
                                ? `${template.description.slice(0, 60)}...`
                                : template.description}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            template.isPublished
                              ? "bg-success/10 text-success-foreground border-success/30"
                              : "bg-warning/10 text-warning-foreground border-warning/30"
                          }
                        >
                          {template.isPublished ? "Published" : "Draft"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {template.fields.length} fields
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {template.createdBy === user?.id ? "You" : `ID: ${template.createdBy}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(template.updatedAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Bulk Invite */}
                          {template.isPublished && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenBulkInvite(template)}
                              className="text-primary hover:text-primary/80 hover:bg-primary/10"
                              title="Bulk Invite"
                            >
                              <Users className="w-4 h-4" />
                            </Button>
                          )}
                          {/* Toggle Publish */}
                          {canEditTemplate(template) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTogglePublish(template)}
                              disabled={togglePublishMutation.isPending}
                              className="text-muted-foreground hover:text-foreground hover:bg-muted"
                              title={template.isPublished ? "Unpublish" : "Publish"}
                            >
                              {template.isPublished ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                          {/* Edit */}
                          {canEditTemplate(template) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(template)}
                              className="text-muted-foreground hover:text-foreground hover:bg-muted"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          {/* Delete */}
                          {canEditTemplate(template) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(template)}
                              disabled={deleteMutation.isPending}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </InternalPanel>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Template?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{templateToDelete?.name}"? This action cannot
                be undone.
                {templateToDelete && (
                  <p className="mt-2 text-sm text-warning">
                    Note: Templates with existing invitations cannot be deleted.
                  </p>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-card text-foreground border-border hover:bg-muted">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => templateToDelete && deleteMutation.mutate(templateToDelete.id)}
                className="bg-destructive hover:bg-destructive/80"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  "Delete"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Invite Dialog */}
        <Dialog open={bulkInviteDialogOpen} onOpenChange={(open) => !open && handleCloseBulkInvite()}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Bulk Invite Candidates
              </DialogTitle>
              <DialogDescription>
                Send form invitations to multiple candidates for "{bulkInviteTemplate?.name}"
              </DialogDescription>
            </DialogHeader>

            {/* Quota Info */}
            {invitationQuota && (
              <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg text-sm">
                <span className="text-muted-foreground">Daily limit:</span>
                <span className="font-medium text-foreground">
                  {invitationQuota.used} / {invitationQuota.limit} used
                </span>
                <span className="text-muted-foreground">
                  ({invitationQuota.remaining} remaining)
                </span>
              </div>
            )}

            {/* Candidate Input Section */}
            <div className="space-y-3">
              <Label className="text-foreground">
                Add Candidate
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Input
                    id="nameInput"
                    placeholder="Candidate name"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                  />
                </div>
                <div>
                  <Input
                    id="emailInput"
                    type="email"
                    placeholder="Email address"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddInvite()}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddInvite}
                  disabled={!emailInput.trim() || !nameInput.trim()}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add to List
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleCsvUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => csvInputRef.current?.click()}
                  title="CSV format: name,email (one per line)"
                >
                  <Upload className="w-4 h-4 mr-1" />
                  Import CSV
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                CSV format: name,email (one candidate per line)
              </p>
            </div>

            {/* Invite Preview List */}
            {inviteList.length > 0 && (
              <div className="space-y-2">
                <Label className="text-foreground">
                  Recipients ({inviteList.length})
                </Label>
                <div className="max-h-48 overflow-y-auto border border-border rounded-lg p-2 space-y-1">
                  {inviteList.map((invite, index) => (
                    <div
                      key={`${invite.email}-${index}`}
                      className="flex items-center justify-between py-1 px-2 bg-muted/50 rounded text-sm"
                    >
                      <div className="flex flex-col">
                        <span className="text-foreground font-medium">{invite.name}</span>
                        <span className="text-muted-foreground text-xs">{invite.email}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveInvite(invite.email)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress Display */}
            {bulkInviteProgress && (
              <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sending invitations...</span>
                  <span className="font-medium text-foreground">
                    {bulkInviteProgress.sent} / {bulkInviteProgress.total}
                  </span>
                </div>
                <Progress
                  value={(bulkInviteProgress.sent / bulkInviteProgress.total) * 100}
                  className="h-2"
                />
                {bulkInviteProgress.sent === bulkInviteProgress.total && (
                  <div className="space-y-2 mt-3">
                    <div className="flex items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle className="w-4 h-4" />
                        {bulkInviteProgress.results.filter(r => r.status === 'sent').length} sent
                      </span>
                      {bulkInviteProgress.results.filter(r => r.status === 'failed').length > 0 && (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="w-4 h-4" />
                          {bulkInviteProgress.results.filter(r => r.status === 'failed').length} failed
                        </span>
                      )}
                    </div>
                    {bulkInviteProgress.results.filter(r => r.status === 'failed').length > 0 && (
                      <div className="text-xs text-destructive max-h-24 overflow-y-auto">
                        {bulkInviteProgress.results
                          .filter(r => r.status === 'failed')
                          .map((r, i) => (
                            <div key={i}>{r.email}: Failed</div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCloseBulkInvite}
              >
                {bulkInviteProgress?.sent === bulkInviteProgress?.total ? "Close" : "Cancel"}
              </Button>
              {(!bulkInviteProgress || bulkInviteProgress.sent !== bulkInviteProgress.total) && (
                <Button
                  type="button"
                  onClick={handleSendBulkInvites}
                  disabled={inviteList.length === 0 || bulkInviteMutation.isPending}
                >
                  {bulkInviteMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Users className="w-4 h-4 mr-2" />
                      Send {inviteList.length} Invitation{inviteList.length !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </InternalPageShell>
  );
}
