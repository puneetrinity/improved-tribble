import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, Link } from "wouter";
import {
  Settings2,
  Building2,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Sparkles,
  Zap,
  Shield,
  Crown,
  RotateCcw,
  History,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface FeatureInfo {
  key: string;
  name: string;
  description: string;
  category: "core" | "ai" | "advanced" | "enterprise";
  defaultByPlan: Record<string, boolean>;
}

interface OrgFeatures {
  organizationId: number;
  organizationName: string;
  planName: string;
  planDisplayName: string;
  features: Record<string, { enabled: boolean; source: "plan" | "override" }>;
  overrides: Record<string, boolean>;
}

interface Organization {
  id: number;
  name: string;
  slug: string;
}

interface AuditLogEntry {
  id: number;
  organizationId: number;
  action: string;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  performedBy: number | null;
  performedAt: string;
  reason: string | null;
  orgName?: string;
}

async function fetchFeatures(): Promise<FeatureInfo[]> {
  const res = await fetch("/api/admin/features", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch features");
  const data = await res.json();
  return data.features;
}

async function fetchOrganizations(): Promise<Organization[]> {
  const res = await fetch("/api/admin/organizations?limit=100", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch organizations");
  const data = await res.json();
  return data.organizations;
}

async function fetchOrgFeatures(orgId: number): Promise<OrgFeatures> {
  const res = await fetch(`/api/admin/organizations/${orgId}/features`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch organization features");
  return res.json();
}

async function fetchAuditLog(): Promise<AuditLogEntry[]> {
  const res = await fetch("/api/admin/features/audit-log", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch audit log");
  return res.json();
}

function getCategoryIcon(category: string) {
  switch (category) {
    case "ai":
      return <Sparkles className="h-4 w-4 text-[#4B8EF0]" />;
    case "advanced":
      return <Zap className="h-4 w-4 text-blue-500" />;
    case "enterprise":
      return <Crown className="h-4 w-4 text-amber-500" />;
    default:
      return <Shield className="h-4 w-4 text-green-500" />;
  }
}

function getCategoryBadge(category: string) {
  switch (category) {
    case "ai":
      return <Badge className="bg-[#4B8EF0]">AI</Badge>;
    case "advanced":
      return <Badge className="bg-blue-500">Advanced</Badge>;
    case "enterprise":
      return <Badge className="bg-amber-500">Enterprise</Badge>;
    default:
      return <Badge className="bg-green-500">Core</Badge>;
  }
}

export default function AdminFeaturesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [changeReason, setChangeReason] = useState("");

  const { data: features, isLoading: featuresLoading } = useQuery({
    queryKey: ["admin", "features"],
    queryFn: fetchFeatures,
  });

  const { data: organizations, isLoading: orgsLoading } = useQuery({
    queryKey: ["admin", "organizations"],
    queryFn: fetchOrganizations,
  });

  const { data: orgFeatures, isLoading: orgFeaturesLoading } = useQuery({
    queryKey: ["admin", "org-features", selectedOrgId],
    queryFn: () => fetchOrgFeatures(selectedOrgId!),
    enabled: !!selectedOrgId,
  });

  const { data: auditLog, isLoading: auditLogLoading } = useQuery({
    queryKey: ["admin", "features-audit-log"],
    queryFn: fetchAuditLog,
    enabled: showAuditLog,
  });

  const updateFeatureMutation = useMutation({
    mutationFn: async ({ orgId, featureKey, value }: { orgId: number; featureKey: string; value: boolean | null }) => {
      const res = await apiRequest("POST", `/api/admin/organizations/${orgId}/features`, {
        overrides: { [featureKey]: value },
        reason: changeReason.trim(),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update feature");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-features", selectedOrgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "features-audit-log"] });
      toast({
        title: "Feature updated",
        description: "Organization feature override has been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFeatureToggle = (featureKey: string, currentEnabled: boolean, hasOverride: boolean) => {
    if (!selectedOrgId) return;
    if (!changeReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please enter a reason before changing features.",
        variant: "destructive",
      });
      return;
    }

    // If currently overridden, toggle the override value
    // If not overridden, set an explicit override opposite to plan default
    const newValue = hasOverride ? !currentEnabled : !currentEnabled;
    updateFeatureMutation.mutate({ orgId: selectedOrgId, featureKey, value: newValue });
  };

  const handleResetToDefault = (featureKey: string) => {
    if (!selectedOrgId) return;
    if (!changeReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please enter a reason before resetting overrides.",
        variant: "destructive",
      });
      return;
    }
    updateFeatureMutation.mutate({ orgId: selectedOrgId, featureKey, value: null });
  };

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto p-6 flex justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!user || user.role !== "super_admin") {
    return <Redirect to="/admin" />;
  }

  const isLoading = featuresLoading || orgsLoading;

  // Group features by category
  const featuresByCategory = features?.reduce<Record<string, FeatureInfo[]>>((acc, feature) => {
    if (!acc[feature.category]) acc[feature.category] = [];
    acc[feature.category]!.push(feature);
    return acc;
  }, {}) || {};

  const categoryOrder = ["core", "ai", "advanced", "enterprise"];

  useEffect(() => {
    if (selectedOrgId && !changeReason.trim()) {
      setChangeReason("Admin override");
    }
  }, [selectedOrgId]);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" aria-label="Back to admin dashboard" asChild>
              <Link href="/admin">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Settings2 className="h-6 w-6" />
                Feature Management
              </h1>
              <p className="text-muted-foreground">
                Manage feature access for organizations
              </p>
            </div>
          </div>
          <Button
            variant={showAuditLog ? "default" : "outline"}
            onClick={() => setShowAuditLog(!showAuditLog)}
          >
            <History className="h-4 w-4 mr-2" />
            {showAuditLog ? "Hide" : "Show"} Audit Log
          </Button>
        </div>

        {/* Organization Selector */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Select Organization
            </CardTitle>
            <CardDescription>
              Choose an organization to manage its feature overrides
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orgsLoading ? (
              <Skeleton className="h-10 w-full max-w-md" />
            ) : (
              <Select
                value={selectedOrgId?.toString() || ""}
                onValueChange={(value) => setSelectedOrgId(parseInt(value))}
              >
                <SelectTrigger className="max-w-md">
                  <SelectValue placeholder="Select an organization..." />
                </SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id.toString()}>
                      {org.name} ({org.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </CardContent>
        </Card>

        {/* Change Reason */}
        {selectedOrgId && (
          <Card>
            <CardHeader>
              <CardTitle>Change Reason</CardTitle>
              <CardDescription>
                Required for any override updates (recorded in the audit log).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                placeholder="Describe why this override is needed"
              />
            </CardContent>
          </Card>
        )}

        {/* Feature List */}
        {isLoading ? (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          categoryOrder.map((category) => {
            const categoryFeatures = featuresByCategory[category];
            if (!categoryFeatures || categoryFeatures.length === 0) return null;

            return (
              <Card key={category}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {getCategoryIcon(category)}
                    <span className="capitalize">{category}</span> Features
                    <Badge variant="secondary" className="ml-2">
                      {categoryFeatures.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead>Description</TableHead>
                        {selectedOrgId && (
                          <>
                            <TableHead className="text-center">Plan Default</TableHead>
                            <TableHead className="text-center">Override</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {categoryFeatures.map((feature) => {
                        const featureState = orgFeatures?.features?.[feature.key];
                        const isEnabled = featureState?.enabled ?? false;
                        const planDefault = feature.defaultByPlan?.[orgFeatures?.planName ?? "free"] ?? false;
                        const hasOverride = orgFeatures?.overrides?.[feature.key] !== undefined;

                        return (
                          <TableRow key={feature.key}>
                            <TableCell className="font-medium">{feature.name}</TableCell>
                            <TableCell className="text-muted-foreground max-w-md">
                              {feature.description}
                            </TableCell>
                            {selectedOrgId && (
                              <>
                                <TableCell className="text-center">
                                  {planDefault ? (
                                    <CheckCircle className="h-5 w-5 text-green-500 inline" />
                                  ) : (
                                    <XCircle className="h-5 w-5 text-muted-foreground inline" />
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  {hasOverride ? (
                                    <Badge variant={isEnabled ? "default" : "destructive"}>
                                      {isEnabled ? "Enabled" : "Disabled"}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  <div className="flex items-center justify-center gap-2">
                                    <Switch
                                      checked={isEnabled}
                                      disabled={orgFeaturesLoading || updateFeatureMutation.isPending || !changeReason.trim()}
                                      onCheckedChange={() => handleFeatureToggle(feature.key, isEnabled, hasOverride)}
                                    />
                                    {isEnabled ? (
                                      <CheckCircle className="h-5 w-5 text-green-500" />
                                    ) : (
                                      <XCircle className="h-5 w-5 text-red-500" />
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  {hasOverride && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleResetToDefault(feature.key)}
                                      disabled={updateFeatureMutation.isPending || !changeReason.trim()}
                                    >
                                      <RotateCcw className="h-4 w-4 mr-1" />
                                      Reset
                                    </Button>
                                  )}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })
        )}

        {/* No org selected message */}
        {!selectedOrgId && !isLoading && (
          <Card>
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Select an organization above to manage its feature overrides
              </p>
            </CardContent>
          </Card>
        )}

        {/* Org Features Info */}
        {selectedOrgId && orgFeatures && (
          <Card>
            <CardHeader>
              <CardTitle>Organization Info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Organization</dt>
                  <dd className="font-medium">{orgFeatures.organizationName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium">{orgFeatures.planDisplayName}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Active Overrides</dt>
                  <dd className="font-medium">
                    {Object.values(orgFeatures.overrides || {}).length}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}


        {/* Audit Log */}
        {showAuditLog && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Recent Feature Changes
              </CardTitle>
              <CardDescription>
                Track admin overrides across all organizations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLogLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : auditLog && auditLog.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Organization</TableHead>
                      <TableHead>Changes</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLog.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(entry.performedAt), "MMM d, yyyy HH:mm")}
                        </TableCell>
                        <TableCell>{entry.orgName || `Org #${entry.organizationId}`}</TableCell>
                        <TableCell className="max-w-md">
                          {(() => {
                            const overrides = (entry.newValue as Record<string, unknown> | null)?.featureOverrides;
                            return overrides ? (
                              <span className="text-sm text-muted-foreground">
                                {JSON.stringify(overrides)}
                              </span>
                            ) : null;
                          })()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {entry.reason || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  No feature changes recorded yet
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
