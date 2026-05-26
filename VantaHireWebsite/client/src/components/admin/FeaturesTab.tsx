import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CheckCircle,
  XCircle,
  Sparkles,
  Zap,
  Shield,
  Crown,
  RotateCcw,
} from "lucide-react";
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

interface FeaturesTabProps {
  orgId: number;
  features: FeatureInfo[] | undefined;
  orgFeatures: OrgFeatures | undefined;
  changeReason: string;
  isLoading: boolean;
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

export default function FeaturesTab({
  orgId,
  features,
  orgFeatures,
  changeReason,
  isLoading,
}: FeaturesTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateFeatureMutation = useMutation({
    mutationFn: async ({ orgId, featureKey, value }: { orgId: number; featureKey: string; value: boolean | null }) => {
      const res = await apiRequest("POST", `/api/admin/organizations/${orgId}/features`, {
        overrides: { [featureKey]: value },
        reason: changeReason.trim() || "Admin override",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update feature");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-features", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "org-audit-log", orgId] });
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

  const handleFeatureToggle = (featureKey: string, currentEnabled: boolean) => {
    if (!changeReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please enter a reason in the Change Reason field.",
        variant: "destructive",
      });
      return;
    }
    updateFeatureMutation.mutate({ orgId, featureKey, value: !currentEnabled });
  };

  const handleResetToDefault = (featureKey: string) => {
    if (!changeReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please enter a reason in the Change Reason field.",
        variant: "destructive",
      });
      return;
    }
    updateFeatureMutation.mutate({ orgId, featureKey, value: null });
  };

  // Group features by category
  const featuresByCategory = features?.reduce<Record<string, FeatureInfo[]>>((acc, feature) => {
    if (!acc[feature.category]) acc[feature.category] = [];
    acc[feature.category]!.push(feature);
    return acc;
  }, {}) || {};

  const categoryOrder = ["core", "ai", "advanced", "enterprise"];

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {categoryOrder.map((category) => {
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
                    <TableHead className="text-center">Plan Default</TableHead>
                    <TableHead className="text-center">Override</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
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
                              disabled={updateFeatureMutation.isPending || !changeReason.trim()}
                              onCheckedChange={() => handleFeatureToggle(feature.key, isEnabled)}
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
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
