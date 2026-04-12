import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  Users,
  Plus,
  Edit,
  Trash2,
  Loader2,
  ExternalLink,
  Search,
} from "lucide-react";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface Consultant {
  id: number;
  name: string;
  experience: string;
  domains: string[];
  description: string;
  photoUrl: string | null;
  linkedinUrl: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ConsultantFormData {
  name: string;
  experience: string;
  domains: string;
  description: string;
  photoUrl: string;
  linkedinUrl: string;
  isActive: boolean;
}

const emptyForm: ConsultantFormData = {
  name: "",
  experience: "",
  domains: "",
  description: "",
  photoUrl: "",
  linkedinUrl: "",
  isActive: true,
};

function normalizeDomains(domains: unknown): string[] {
  if (Array.isArray(domains)) {
    return domains.filter((domain): domain is string => typeof domain === "string");
  }
  if (typeof domains === "string") {
    return domains
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean);
  }
  return [];
}

export default function AdminConsultantsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingConsultant, setEditingConsultant] = useState<Consultant | null>(null);
  const [deleteConsultant, setDeleteConsultant] = useState<Consultant | null>(null);
  const [formData, setFormData] = useState<ConsultantFormData>(emptyForm);

  // Redirect non-admin users
  if (!user || user.role !== "super_admin") {
    return <Redirect to="/recruiter-auth" />;
  }

  // Fetch all consultants
  const { data: consultants = [], isLoading } = useQuery<Consultant[]>({
    queryKey: ["/api/admin/consultants"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/consultants");
      const data = await res.json();
      if (!Array.isArray(data)) {
        return [];
      }
      return data.map((consultant) => ({
        ...consultant,
        domains: normalizeDomains(consultant.domains),
      }));
    },
  });

  // Create consultant mutation
  const createMutation = useMutation({
    mutationFn: async (data: Omit<Consultant, "id" | "createdAt">) => {
      const res = await apiRequest("POST", "/api/admin/consultants", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultants"] });
      toast({ title: "Consultant Created", description: "New consultant has been added successfully." });
      handleCloseForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update consultant mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Consultant> }) => {
      const res = await apiRequest("PATCH", `/api/admin/consultants/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultants"] });
      toast({ title: "Consultant Updated", description: "Consultant details have been updated." });
      handleCloseForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete consultant mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/consultants/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/consultants"] });
      toast({ title: "Consultant Deleted", description: "Consultant has been removed." });
      setDeleteConsultant(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleOpenCreate = () => {
    setEditingConsultant(null);
    setFormData(emptyForm);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (consultant: Consultant) => {
    const domains = normalizeDomains(consultant.domains);
    setEditingConsultant(consultant);
    setFormData({
      name: consultant.name,
      experience: consultant.experience,
      domains: domains.join(", "),
      description: consultant.description,
      photoUrl: consultant.photoUrl || "",
      linkedinUrl: consultant.linkedinUrl || "",
      isActive: consultant.isActive,
    });
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingConsultant(null);
    setFormData(emptyForm);
  };

  const handleSubmit = () => {
    const data = {
      name: formData.name.trim(),
      experience: formData.experience.trim(),
      domains: formData.domains.split(",").map(d => d.trim()).filter(Boolean),
      description: formData.description.trim(),
      photoUrl: formData.photoUrl.trim() || null,
      linkedinUrl: formData.linkedinUrl.trim() || null,
      isActive: formData.isActive,
    };

    if (!data.name || !data.experience || !data.description) {
      toast({ title: "Validation Error", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }

    if (editingConsultant) {
      updateMutation.mutate({ id: editingConsultant.id, data });
    } else {
      createMutation.mutate(data as any);
    }
  };

  // Filter consultants
  const filteredConsultants = consultants.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    normalizeDomains(c.domains).some(d => d.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const activeCount = consultants.filter(c => c.isActive).length;

  return (
    <Layout>
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
                <Users className="w-8 h-8 text-primary" />
                Consultant Management
              </h1>
              <p className="text-muted-foreground mt-1">Manage consultant profiles displayed on the public page</p>
            </div>
            <Button onClick={handleOpenCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Add Consultant
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Consultants</p>
                    <p className="text-2xl font-bold text-foreground">{consultants.length}</p>
                  </div>
                  <Users className="w-8 h-8 text-primary opacity-50" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Active</p>
                    <p className="text-2xl font-bold text-success">{activeCount}</p>
                  </div>
                  <Badge className="bg-success/20 text-success-foreground">Live</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Inactive</p>
                    <p className="text-2xl font-bold text-muted-foreground">{consultants.length - activeCount}</p>
                  </div>
                  <Badge variant="secondary">Hidden</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Search */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or domain..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Consultants Table */}
          <Card>
            <CardHeader>
              <CardTitle>Consultants</CardTitle>
              <CardDescription>{filteredConsultants.length} consultant{filteredConsultants.length !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                </div>
              ) : filteredConsultants.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No consultants found</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultant</TableHead>
                      <TableHead>Experience</TableHead>
                      <TableHead>Domains</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredConsultants.map((consultant) => {
                      const domains = normalizeDomains(consultant.domains);
                      return (
                      <TableRow key={consultant.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {consultant.photoUrl ? (
                              <img
                                src={consultant.photoUrl}
                                alt={consultant.name}
                                className="w-10 h-10 rounded-full object-cover"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <span className="text-primary font-semibold">
                                  {consultant.name.charAt(0)}
                                </span>
                              </div>
                            )}
                            <div>
                              <p className="font-medium text-foreground">{consultant.name}</p>
                              {consultant.linkedinUrl && (
                                <a
                                  href={consultant.linkedinUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-info hover:underline inline-flex items-center gap-1"
                                >
                                  LinkedIn <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{consultant.experience}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {domains.slice(0, 3).map((domain, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {domain}
                              </Badge>
                            ))}
                            {domains.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{domains.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={consultant.isActive ? "bg-success/20 text-success-foreground" : "bg-muted text-muted-foreground"}>
                            {consultant.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => handleOpenEdit(consultant)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteConsultant(consultant)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={isFormOpen} onOpenChange={(open) => !open && handleCloseForm()}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingConsultant ? "Edit Consultant" : "Add Consultant"}</DialogTitle>
              <DialogDescription>
                {editingConsultant ? "Update consultant details" : "Add a new consultant to display on the public page"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., John Smith"
                />
              </div>
              <div>
                <Label>Experience *</Label>
                <Input
                  value={formData.experience}
                  onChange={(e) => setFormData({ ...formData, experience: e.target.value })}
                  placeholder="e.g., 15+ years in Tech Recruitment"
                />
              </div>
              <div>
                <Label>Domains (comma-separated) *</Label>
                <Input
                  value={formData.domains}
                  onChange={(e) => setFormData({ ...formData, domains: e.target.value })}
                  placeholder="e.g., IT, Healthcare, Finance"
                />
              </div>
              <div>
                <Label>Description *</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief bio about the consultant..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Photo URL</Label>
                <Input
                  value={formData.photoUrl}
                  onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div>
                <Label>LinkedIn URL</Label>
                <Input
                  value={formData.linkedinUrl}
                  onChange={(e) => setFormData({ ...formData, linkedinUrl: e.target.value })}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                />
                <Label>Active (visible on public page)</Label>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCloseForm}>Cancel</Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {editingConsultant ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteConsultant} onOpenChange={(open) => !open && setDeleteConsultant(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Consultant?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete {deleteConsultant?.name}? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/80"
                onClick={() => deleteConsultant && deleteMutation.mutate(deleteConsultant.id)}
              >
                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Layout>
  );
}
