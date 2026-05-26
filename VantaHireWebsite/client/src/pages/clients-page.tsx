import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Building2, Mail, Plus, Loader2, Search } from "lucide-react";
import { clientsPageCopy } from "@/lib/internal-copy";
import {
  InternalEmptyState,
  InternalHero,
  InternalPageShell,
  InternalPanel,
  InternalSectionHeader,
} from "@/components/internal";

export default function ClientsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [primaryContactEmail, setPrimaryContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  interface ClientAnalytics {
    clientId: number;
    clientName: string;
    rolesCount: number;
    totalApplications: number;
    placementsCount: number;
  }

  // Protect route (should also be wrapped in ProtectedRoute)
  if (user && !["super_admin", "recruiter"].includes(user.role)) {
    return <Redirect to="/jobs" />;
  }

  const {
    data: clients = [],
    isLoading,
  } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch clients");
      }
      return res.json();
    },
    enabled: !!user && ["super_admin", "recruiter"].includes(user.role),
  });

  const { data: clientMetrics = [] } = useQuery<ClientAnalytics[]>({
    queryKey: ["/api/analytics/clients"],
    queryFn: async () => {
      const res = await fetch("/api/analytics/clients", {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Failed to fetch client analytics");
      }
      return res.json();
    },
    enabled: !!user && ["super_admin", "recruiter"].includes(user.role),
  });

  const metricsByClientId = new Map<number, ClientAnalytics>();
  clientMetrics.forEach((m) => metricsByClientId.set(m.clientId, m));

  const resetForm = () => {
    setEditingClient(null);
    setName("");
    setDomain("");
    setPrimaryContactName("");
    setPrimaryContactEmail("");
    setNotes("");
  };

  const openCreateDialog = () => {
    resetForm();
    setShowDialog(true);
  };

  const openEditDialog = (client: Client) => {
    setEditingClient(client);
    setName(client.name);
    setDomain(client.domain ?? "");
    setPrimaryContactName(client.primaryContactName ?? "");
    setPrimaryContactEmail(client.primaryContactEmail ?? "");
    setNotes(client.notes ?? "");
    setShowDialog(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        domain: domain || undefined,
        primaryContactName: primaryContactName || undefined,
        primaryContactEmail: primaryContactEmail || undefined,
        notes: notes || undefined,
      };
      const res = await apiRequest("POST", "/api/clients", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: clientsPageCopy.toasts.createdTitle,
        description: clientsPageCopy.toasts.createdDescription,
      });
      setShowDialog(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({
        title: clientsPageCopy.toasts.createFailedTitle,
        description: error.message || clientsPageCopy.toasts.createFailedDescription,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingClient) return;
      const payload = {
        ...(name && { name }),
        domain: domain || null,
        primaryContactName: primaryContactName || null,
        primaryContactEmail: primaryContactEmail || null,
        notes: notes || null,
      };
      const res = await apiRequest("PATCH", `/api/clients/${editingClient.id}`, payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({
        title: clientsPageCopy.toasts.updatedTitle,
        description: clientsPageCopy.toasts.updatedDescription,
      });
      setShowDialog(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({
        title: clientsPageCopy.toasts.updateFailedTitle,
        description: error.message || clientsPageCopy.toasts.updateFailedDescription,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast({
        title: clientsPageCopy.toasts.missingNameTitle,
        description: clientsPageCopy.toasts.missingNameDescription,
        variant: "destructive",
      });
      return;
    }
    if (editingClient) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const filteredClients = clients.filter((client) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const haystack = `${client.name} ${client.domain ?? ""} ${client.primaryContactName ?? ""} ${
      client.primaryContactEmail ?? ""
    }`.toLowerCase();
    return haystack.includes(q);
  });

  return (
    <InternalPageShell>
      <InternalHero
        eyebrow="Client Workspace"
        title={clientsPageCopy.header.title}
        subtitle={clientsPageCopy.header.subtitle}
        icon={Building2}
        actions={
          <Button
            onClick={openCreateDialog}
            data-tour="add-client-button"
            className="h-11 rounded-2xl bg-[#4B8EF0] px-5 font-semibold text-white shadow-[0_10px_22px_rgba(75,142,240,0.22)] hover:bg-[#3679DB]"
          >
            <Plus className="mr-2 h-4 w-4" />
            {clientsPageCopy.header.addClient}
          </Button>
        }
        stats={[
          { label: "Clients", value: clients.length },
          { label: "Open Roles", value: clientMetrics.reduce((sum, metric) => sum + metric.rolesCount, 0) },
          {
            label: "Applications",
            value: clientMetrics.reduce((sum, metric) => sum + metric.totalApplications, 0),
            accentClassName: "text-[#4B8EF0]",
          },
        ]}
      />

      <InternalPanel className="p-4 sm:p-5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7B8191]" />
          <Input
            placeholder={clientsPageCopy.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-11 rounded-2xl border-[#E5E7EB] bg-[#FAFAFB] pl-10 font-outfit text-sm text-[#111827] shadow-[0_3px_10px_rgba(15,23,42,0.04)] placeholder:text-[#9CA3AF]"
          />
        </div>
      </InternalPanel>

      <InternalPanel className="p-5" data-tour="clients-list">
        <InternalSectionHeader
          title={clientsPageCopy.list.title}
          description={clientsPageCopy.list.description}
        />
        <div className="mt-5">
          {isLoading ? (
            <InternalEmptyState
              icon={Loader2}
              title="Loading clients"
              className="[&_svg]:animate-spin"
            />
          ) : filteredClients.length === 0 ? (
            <InternalEmptyState
              icon={Building2}
              title={clientsPageCopy.list.emptyTitle}
              description={clientsPageCopy.list.emptyDescription}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-muted/50">
                    <TableHead className="text-muted-foreground">{clientsPageCopy.list.columns.name}</TableHead>
                    <TableHead className="text-muted-foreground">{clientsPageCopy.list.columns.domain}</TableHead>
                    <TableHead className="text-muted-foreground">{clientsPageCopy.list.columns.primaryContact}</TableHead>
                    <TableHead className="text-muted-foreground">{clientsPageCopy.list.columns.email}</TableHead>
                    <TableHead className="text-muted-foreground hidden md:table-cell">
                      {clientsPageCopy.list.columns.notes}
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right">
                      {clientsPageCopy.list.columns.roles}
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right">
                      {clientsPageCopy.list.columns.applications}
                    </TableHead>
                    <TableHead className="text-muted-foreground text-right">
                      {clientsPageCopy.list.columns.actions}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client) => (
                    <TableRow key={client.id} className="border-border hover:bg-muted/50">
                      <TableCell className="text-foreground font-medium">
                        {client.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {client.domain ? (
                          <a
                            href={
                              client.domain.startsWith("http")
                                ? client.domain
                                : `https://${client.domain}`
                            }
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {client.domain}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs">{clientsPageCopy.list.notSet}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {client.primaryContactName ? (
                          client.primaryContactName
                        ) : (
                          <span className="text-muted-foreground text-xs">{clientsPageCopy.list.notSet}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {client.primaryContactEmail ? (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="w-3 h-3 text-muted-foreground" />
                            {client.primaryContactEmail}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">{clientsPageCopy.list.notSet}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs hidden md:table-cell max-w-xs">
                        {client.notes ? (
                          <span className="line-clamp-2">{client.notes}</span>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {metricsByClientId.get(client.id)?.rolesCount ?? 0}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {metricsByClientId.get(client.id)?.totalApplications ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(client)}
                        >
                          {clientsPageCopy.list.edit}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </InternalPanel>

      {/* Create / Edit Dialog */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open);
          if (!open) resetForm();
        }}
      >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingClient ? clientsPageCopy.dialog.editTitle : clientsPageCopy.dialog.addTitle}
              </DialogTitle>
              <DialogDescription>
                {editingClient
                  ? clientsPageCopy.dialog.editDescription
                  : clientsPageCopy.dialog.addDescription}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="client-name">{clientsPageCopy.dialog.name}</Label>
                <Input
                  id="client-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                  placeholder={clientsPageCopy.dialog.namePlaceholder}
                />
              </div>
              <div>
                <Label htmlFor="client-domain">{clientsPageCopy.dialog.domain}</Label>
                <Input
                  id="client-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="mt-1"
                  placeholder={clientsPageCopy.dialog.domainPlaceholder}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="client-contact-name">{clientsPageCopy.dialog.contactName}</Label>
                  <Input
                    id="client-contact-name"
                    value={primaryContactName}
                    onChange={(e) => setPrimaryContactName(e.target.value)}
                    className="mt-1"
                    placeholder={clientsPageCopy.dialog.contactNamePlaceholder}
                  />
                </div>
                <div>
                  <Label htmlFor="client-contact-email">{clientsPageCopy.dialog.contactEmail}</Label>
                  <Input
                    id="client-contact-email"
                    type="email"
                    value={primaryContactEmail}
                    onChange={(e) => setPrimaryContactEmail(e.target.value)}
                    className="mt-1"
                    placeholder={clientsPageCopy.dialog.contactEmailPlaceholder}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="client-notes">{clientsPageCopy.dialog.notes}</Label>
                <Textarea
                  id="client-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1"
                  rows={3}
                  placeholder={clientsPageCopy.dialog.notesPlaceholder}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowDialog(false);
                  resetForm();
                }}
              >
                {clientsPageCopy.dialog.cancel}
              </Button>
              <Button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {clientsPageCopy.dialog.save}
              </Button>
            </div>
          </DialogContent>
      </Dialog>
    </InternalPageShell>
  );
}
