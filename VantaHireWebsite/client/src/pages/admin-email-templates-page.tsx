import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { EmailTemplate } from "@shared/schema";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Mail, Plus, Loader2, Eye, Pencil } from "lucide-react";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";

export default function AdminEmailTemplatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "super_admin";
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [name, setName] = useState("");
  const [templateType, setTemplateType] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editTemplateType, setEditTemplateType] = useState<string>("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  // Redirect if not admin or recruiter
  if (user && !["super_admin", "recruiter"].includes(user.role)) {
    return <Redirect to="/jobs" />;
  }

  // Fetch email templates
  const {
    data: templates = [],
    isLoading,
  } = useQuery<EmailTemplate[]>({
    queryKey: ["/api/email-templates"],
    queryFn: async () => {
      const res = await fetch("/api/email-templates", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch email templates");
      }
      return res.json();
    },
    enabled: !!user && ["super_admin", "recruiter"].includes(user.role),
  });

  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        subject,
        body,
        templateType: templateType || "custom",
        isDefault: false,
      };
      const res = await apiRequest("POST", "/api/email-templates", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Template Created",
        description: "Email template has been created successfully.",
      });
      setShowCreateDialog(false);
      setName("");
      setTemplateType("");
      setSubject("");
      setBody("");
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Template",
        description: error.message || "An error occurred while creating the template.",
        variant: "destructive",
      });
    },
  });

  const toggleDefaultMutation = useMutation({
    mutationFn: async ({ id, isDefault }: { id: number; isDefault: boolean }) => {
      const res = await apiRequest("PATCH", `/api/email-templates/${id}`, { isDefault });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Template Updated",
        description: "Default status updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Template",
        description: error.message || "Only admins can approve templates.",
        variant: "destructive",
      });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: { name: string; subject: string; body: string; templateType: string } }) => {
      const res = await apiRequest("PATCH", `/api/email-templates/${id}`, updates);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-templates"] });
      toast({
        title: "Template Updated",
        description: "Email template has been updated successfully.",
      });
      setShowEditDialog(false);
      setSelectedTemplate(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Template",
        description: error.message || "An error occurred while updating the template.",
        variant: "destructive",
      });
    },
  });

  const handleCreate = () => {
    if (!name || !subject || !body) {
      toast({
        title: "Missing fields",
        description: "Name, subject, and body are required.",
        variant: "destructive",
      });
      return;
    }
    createTemplateMutation.mutate();
  };

  const handlePreview = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setShowPreviewDialog(true);
  };

  const handleEdit = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setEditName(template.name);
    setEditSubject(template.subject);
    setEditBody(template.body);
    setEditTemplateType(template.templateType);
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTemplate || !editName || !editSubject || !editBody) {
      toast({
        title: "Missing fields",
        description: "Name, subject, and body are required.",
        variant: "destructive",
      });
      return;
    }
    updateTemplateMutation.mutate({
      id: selectedTemplate.id,
      updates: {
        name: editName,
        subject: editSubject,
        body: editBody,
        templateType: editTemplateType || "custom",
      },
    });
  };

  const templateTypeLabel = (type: string) => {
    switch (type) {
      case "application_received":
        return "Application Received";
      case "interview_invite":
        return "Interview Invitation";
      case "status_update":
        return "Status Update";
      case "offer_extended":
        return "Offer Extended";
      case "rejection":
        return "Rejection";
      default:
        return "Custom";
    }
  };

  const filteredTemplates = templates
    .filter((template) => typeFilter === "all" || template.templateType === typeFilter)
    .sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1;
      if (!a.isDefault && b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Communication Library"
        title="Email Templates"
        subtitle="View and create reusable email templates for candidates."
        icon={Mail}
        actions={
          user && ["super_admin", "recruiter"].includes(user.role) ? (
            <Button
              onClick={() => setShowCreateDialog(true)}
              data-tour="create-template-button"
              className="h-11 rounded-2xl bg-[#4B8EF0] px-5 font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#3679DB]"
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Template
            </Button>
          ) : null
        }
        stats={[
          { label: "Templates", value: templates.length },
          { label: "Defaults", value: templates.filter((template) => template.isDefault).length },
          {
            label: "Visible",
            value: filteredTemplates.length,
            accentClassName: "text-[#4B8EF0]",
          },
        ]}
      />

      <InternalPanel className="p-5" data-tour="email-templates-list">
        <InternalSectionHeader
          title="Templates"
          description={
            user?.role === "super_admin"
              ? "All email templates (system defaults and custom templates)"
              : "Email templates available for your Flow workflows"
          }
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { value: "all", label: "All" },
            { value: "application_received", label: "App Received" },
            { value: "interview_invite", label: "Interview" },
            { value: "status_update", label: "Status Update" },
            { value: "offer_extended", label: "Offer" },
            { value: "rejection", label: "Rejection" },
            { value: "custom", label: "Custom" },
          ].map(({ value, label }) => (
            <Badge
              key={value}
              variant={typeFilter === value ? "default" : "outline"}
              className="cursor-pointer rounded-full px-3 py-1 font-dm text-xs hover:bg-primary/10"
              onClick={() => setTypeFilter(value)}
            >
              {label}
            </Badge>
          ))}
        </div>

        <div className="mt-5">
          {isLoading ? (
            <InternalEmptyState
              icon={Loader2}
              title="Loading email templates"
              className="[&_svg]:animate-spin"
            />
          ) : templates.length === 0 ? (
            <InternalEmptyState
              icon={Mail}
              title="No email templates yet"
              description="Create your first template to standardize candidate communication."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-muted/50">
                    <TableHead className="text-muted-foreground">Name</TableHead>
                    <TableHead className="text-muted-foreground">Type</TableHead>
                    <TableHead className="text-muted-foreground">Default</TableHead>
                    <TableHead className="text-muted-foreground">Subject</TableHead>
                    <TableHead className="text-muted-foreground">Created By</TableHead>
                    <TableHead className="text-muted-foreground">Created</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTemplates.map((tpl) => (
                    <TableRow
                      key={tpl.id}
                      data-template-id={tpl.id}
                      className={`border-border hover:bg-muted/50 ${tpl.isDefault ? 'bg-success/10/30' : ''}`}
                    >
                      <TableCell className="text-foreground font-medium">
                        {tpl.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        <Badge className="bg-muted text-foreground border-border">
                          {templateTypeLabel(tpl.templateType)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {tpl.isDefault ? (
                          <Badge className="bg-success/10 text-success-foreground border-success/30">
                            Default
                          </Badge>
                        ) : (
                          <Badge className="bg-muted text-muted-foreground border-border">
                            Custom
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {tpl.subject.length > 60
                          ? `${tpl.subject.slice(0, 60)}...`
                          : tpl.subject}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {tpl.createdBy === user?.id ? "You" : tpl.createdBy ? `ID: ${tpl.createdBy}` : "System"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {tpl.createdAt
                          ? new Date(tpl.createdAt as unknown as string).toLocaleDateString()
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={() => handlePreview(tpl)}
                            title="Preview template"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                            onClick={() => handleEdit(tpl)}
                            title="Edit template"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground hover:bg-muted"
                              onClick={() =>
                                toggleDefaultMutation.mutate({
                                  id: tpl.id,
                                  isDefault: !tpl.isDefault,
                                })
                              }
                              disabled={toggleDefaultMutation.isPending}
                              title={tpl.isDefault ? "Unset as default" : "Mark as default"}
                            >
                              {toggleDefaultMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : tpl.isDefault ? (
                                "Unset"
                              ) : (
                                "Default"
                              )}
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

        {/* Create Template Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Email Template</DialogTitle>
              <DialogDescription>
                Define a reusable template for candidate communication. You can insert variables like
                <span className="font-mono">{"{{candidate_name}}"}</span> and{" "}
                <span className="font-mono">{"{{job_title}}"}</span> in the subject and body.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Template Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Interview Reminder"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Template Type</Label>
                <Select
                  value={templateType}
                  onValueChange={setTemplateType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application_received">Application Received</SelectItem>
                    <SelectItem value="interview_invite">Interview Invitation</SelectItem>
                    <SelectItem value="status_update">Status Update</SelectItem>
                    <SelectItem value="offer_extended">Offer Extended</SelectItem>
                    <SelectItem value="rejection">Rejection</SelectItem>
                    <SelectItem value="custom">Custom / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Interview Invitation - {{job_title}} at ealana"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Body</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder={`Dear {{candidate_name}},\n\nThank you for applying for the {{job_title}} position...\n`}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={createTemplateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={createTemplateMutation.isPending}
              >
                {createTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Template"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Preview Template Dialog */}
        <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Preview: {selectedTemplate?.name}
              </DialogTitle>
              <DialogDescription>
                Preview how this email template will appear. Variables like{" "}
                <span className="font-mono text-xs">{"{{candidate_name}}"}</span> will be replaced with actual values when sent.
              </DialogDescription>
            </DialogHeader>
            {selectedTemplate && (
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Type</Label>
                  <Badge className="bg-muted text-foreground border-border">
                    {templateTypeLabel(selectedTemplate.templateType)}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Subject</Label>
                  <div className="p-3 rounded-md bg-muted/50 border border-border">
                    <p className="text-foreground font-medium">{selectedTemplate.subject}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Body</Label>
                  <div className="p-4 rounded-md bg-muted/50 border border-border min-h-[200px]">
                    <pre className="text-foreground text-sm whitespace-pre-wrap font-sans">
                      {selectedTemplate.body}
                    </pre>
                  </div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPreviewDialog(false)}>
                Close
              </Button>
              <Button onClick={() => {
                setShowPreviewDialog(false);
                if (selectedTemplate) handleEdit(selectedTemplate);
              }}>
                <Pencil className="w-4 h-4 mr-2" />
                Edit Template
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Template Dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Email Template</DialogTitle>
              <DialogDescription>
                Update the template details. You can use variables like{" "}
                <span className="font-mono">{"{{candidate_name}}"}</span> and{" "}
                <span className="font-mono">{"{{job_title}}"}</span> in the subject and body.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Template Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Interview Reminder"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Template Type</Label>
                <Select
                  value={editTemplateType}
                  onValueChange={setEditTemplateType}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application_received">Application Received</SelectItem>
                    <SelectItem value="interview_invite">Interview Invitation</SelectItem>
                    <SelectItem value="status_update">Status Update</SelectItem>
                    <SelectItem value="offer_extended">Offer Extended</SelectItem>
                    <SelectItem value="rejection">Rejection</SelectItem>
                    <SelectItem value="custom">Custom / Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Subject</Label>
                <Input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="e.g. Interview Invitation - {{job_title}} at ealana"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm text-foreground">Body</Label>
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={8}
                  placeholder={`Dear {{candidate_name}},\n\nThank you for applying for the {{job_title}} position...\n`}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="outline"
                onClick={() => setShowEditDialog(false)}
                disabled={updateTemplateMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateTemplateMutation.isPending}
              >
                {updateTemplateMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
    </InternalPageShell>
  );
}
