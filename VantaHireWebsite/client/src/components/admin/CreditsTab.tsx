import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Sparkles, Gift, Settings, AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { apiRequest } from "@/lib/queryClient";

interface CreditDetails {
  organizationId: number;
  organizationName: string;
  planAllocation: number;
  bonusCredits: number;
  customLimit: number | null;
  effectiveLimit: number;
  purchasedCredits: number;
  rolloverCredits: number;
  proratedCreditsAddedThisPeriod: number;
  usedThisPeriod: number;
  remaining: number;
  periodStart: string | null;
  periodEnd: string | null;
  seatedMembers: number;
  memberBreakdown: {
    userId: number;
    name: string;
    email: string;
    used: number;
    seatAssigned: boolean;
  }[];
  ledger: {
    id: number;
    type: string;
    amount: number;
    createdAt: string;
    actor: {
      userId: number | null;
      name: string | null;
      email: string | null;
    };
    metadata: Record<string, any> | null;
  }[];
  warningState: {
    recipients: string[];
    recentAlerts: {
      alertType: string;
      recipientEmail: string;
      sentAt: string;
    }[];
  };
}

interface CreditsTabProps {
  orgId: number;
  planName: string;
}

async function fetchCredits(orgId: number): Promise<CreditDetails> {
  const res = await fetch(`/api/admin/organizations/${orgId}/credits`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch credits");
  return res.json();
}

export default function CreditsTab({ orgId, planName }: CreditsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [bonusAmount, setBonusAmount] = useState("");
  const [bonusReason, setBonusReason] = useState("");
  const [customLimit, setCustomLimit] = useState("");
  const [customLimitReason, setCustomLimitReason] = useState("");

  const { data: credits, isLoading, error } = useQuery({
    queryKey: ["admin", "org-credits", orgId],
    queryFn: () => fetchCredits(orgId),
    enabled: !!orgId,
  });

  const grantBonusMutation = useMutation({
    mutationFn: async (data: { amount: number; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/organizations/${orgId}/credits/bonus`, data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to grant bonus credits");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-credits", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "org-audit-log", orgId] });
      toast({
        title: "Bonus credits granted",
        description: `Granted ${data.totalGranted} shared credits to the organization pool.`,
      });
      setBonusAmount("");
      setBonusReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const setCustomLimitMutation = useMutation({
    mutationFn: async (data: { customLimit: number | null; reason: string }) => {
      const res = await apiRequest("POST", `/api/admin/organizations/${orgId}/credits/custom-limit`, data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to set custom limit");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-credits", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "org-audit-log", orgId] });
      toast({
        title: "Custom limit set",
        description: "The custom credit limit has been updated.",
      });
      setCustomLimit("");
      setCustomLimitReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const clearBonusMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/organizations/${orgId}/credits/bonus`, {
        reason: "Admin cleared bonus credits",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to clear bonus credits");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-credits", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "org-audit-log", orgId] });
      toast({
        title: "Bonus credits cleared",
        description: `Cleared ${data.previousAmount} bonus credits.`,
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

  const handleGrantBonus = () => {
    const amount = parseInt(bonusAmount);
    if (!amount || amount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid positive number.",
        variant: "destructive",
      });
      return;
    }
    if (!bonusReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for granting bonus credits.",
        variant: "destructive",
      });
      return;
    }
    grantBonusMutation.mutate({ amount, reason: bonusReason });
  };

  const handleSetCustomLimit = () => {
    const limit = customLimit.trim() === "" ? null : parseInt(customLimit);
    if (limit !== null && (isNaN(limit) || limit < 0)) {
      toast({
        title: "Invalid limit",
        description: "Please enter a valid non-negative number or leave empty to clear.",
        variant: "destructive",
      });
      return;
    }
    if (!customLimitReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for setting the custom limit.",
        variant: "destructive",
      });
      return;
    }
    setCustomLimitMutation.mutate({ customLimit: limit, reason: customLimitReason });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !credits) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
            <p>Failed to load credit information.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const utilizationPercent = credits.effectiveLimit > 0
    ? Math.round((credits.usedThisPeriod / credits.effectiveLimit) * 100)
    : 0;
  const formatLedgerType = (type: string, metadata?: Record<string, any> | null) => {
    if (type === "cycle_reset") return "Monthly allocation reset";
    if (type === "seat_add_proration") {
      const seatsAdded = Number(metadata?.additionalSeats || 0);
      return seatsAdded > 0 ? `Seat add proration (+${seatsAdded} seat${seatsAdded === 1 ? "" : "s"})` : "Seat add proration";
    }
    if (type === "credit_pack_purchase") return "Credit pack purchase";
    if (type === "bonus_grant") return "Bonus grant";
    if (type === "bonus_clear") return "Bonus clear";
    if (type === "custom_limit") return "Custom limit change";
    if (type === "migration") return "Legacy migration";
    if (type === "usage") return "AI usage";
    return type.replace(/_/g, " ");
  };
  const formatLedgerAmount = (type: string, amount: number) => {
    const negativeTypes = new Set(["usage", "bonus_clear"]);
    return `${negativeTypes.has(type) ? "-" : "+"}${Math.abs(amount).toLocaleString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Credit Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Credit Allocation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Plan Allocation</p>
                <p className="text-2xl font-bold">{credits.planAllocation.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">
                  {credits.seatedMembers} seats
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Bonus Credits</p>
                <p className="text-2xl font-bold text-purple-500">
                  +{credits.bonusCredits.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Used This Period</p>
                <p className="text-2xl font-bold">{credits.usedThisPeriod.toLocaleString()}</p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Remaining</p>
                <p className="text-2xl font-bold text-green-500">
                  {credits.remaining.toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Purchased Available</p>
                <p className="text-2xl font-bold">{credits.purchasedCredits.toLocaleString()}</p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Rollover Carried</p>
                <p className="text-2xl font-bold">{credits.rolloverCredits.toLocaleString()}</p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Seat Proration Added</p>
                <p className="text-2xl font-bold">{credits.proratedCreditsAddedThisPeriod.toLocaleString()}</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Usage: {credits.usedThisPeriod.toLocaleString()} / {credits.effectiveLimit.toLocaleString()}</span>
                <span>{utilizationPercent}%</span>
              </div>
              <Progress value={utilizationPercent} className="h-2" />
            </div>

            {/* Custom Limit Badge */}
            {credits.customLimit !== null && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  <Settings className="h-3 w-3 mr-1" />
                  Custom Limit: {credits.customLimit.toLocaleString()}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  (overrides plan default)
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warning Recipients</CardTitle>
          <CardDescription>
            Credit warning emails go to the billing contact if set, plus the organization owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {credits.warningState.recipients.length > 0 ? (
              credits.warningState.recipients.map((recipient) => (
                <Badge key={recipient} variant="secondary">{recipient}</Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No warning recipients configured.</p>
            )}
          </div>
          {credits.warningState.recentAlerts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.warningState.recentAlerts.map((alert) => (
                  <TableRow key={`${alert.alertType}-${alert.recipientEmail}-${alert.sentAt}`}>
                    <TableCell>{alert.alertType.replace("credit_usage_", "").replace(/_/g, " ")}%</TableCell>
                    <TableCell>{alert.recipientEmail}</TableCell>
                    <TableCell>{new Date(alert.sentAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Grant Bonus Credits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5" />
            Grant Bonus Credits
          </CardTitle>
          <CardDescription>
            Add one-time bonus credits to this organization. Use for rewards, promotions, or retention.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              min={1}
              max={100000}
              value={bonusAmount}
              onChange={(e) => setBonusAmount(e.target.value)}
              placeholder="500"
            />
            <p className="text-xs text-muted-foreground">
              Credits are added to the shared org pool immediately.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={bonusReason}
              onChange={(e) => setBonusReason(e.target.value)}
              placeholder="e.g., Reward for active usage, Sales promotion, Retention offer..."
              rows={2}
            />
          </div>
          <div className="flex items-center justify-between">
            {credits.bonusCredits > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearBonusMutation.mutate()}
                disabled={clearBonusMutation.isPending}
              >
                {clearBonusMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Clear Bonus ({credits.bonusCredits})
              </Button>
            )}
            <Button
              onClick={handleGrantBonus}
              disabled={grantBonusMutation.isPending}
              className="ml-auto"
            >
              {grantBonusMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Grant Credits
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Custom Credit Limit (Business plan feature) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Custom Credit Limit
          </CardTitle>
          <CardDescription>
            Override the monthly credit limit for this organization. Leave empty to use plan default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Custom Monthly Limit</Label>
              <Input
                type="number"
                min={0}
                value={customLimit}
                onChange={(e) => setCustomLimit(e.target.value)}
                placeholder={credits.customLimit?.toString() || "Leave empty for plan default"}
              />
              <p className="text-xs text-muted-foreground">
                Current: {credits.customLimit !== null ? credits.customLimit.toLocaleString() : "Using plan default"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Reason <span className="text-destructive">*</span></Label>
              <Textarea
                value={customLimitReason}
                onChange={(e) => setCustomLimitReason(e.target.value)}
                placeholder="e.g., Enterprise agreement, Custom contract..."
                rows={2}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleSetCustomLimit}
              disabled={setCustomLimitMutation.isPending}
            >
              {setCustomLimitMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Set Custom Limit
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Member Breakdown */}
      {credits.memberBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Member Usage Breakdown</CardTitle>
            <CardDescription>
              Credits are now shared at the organization level. This view shows who used them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Seat</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.memberBreakdown.map((member) => {
                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={member.seatAssigned ? "secondary" : "outline"}>
                          {member.seatAssigned ? "Seated" : "Unseated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{member.used.toLocaleString()}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {credits.ledger.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Credit Ledger</CardTitle>
            <CardDescription>
              Full org-level credit events for included allocations, proration, top-ups, and usage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credits.ledger.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{formatLedgerType(entry.type, entry.metadata)}</p>
                        {entry.type === "custom_limit" && entry.metadata?.reason && (
                          <p className="text-xs text-muted-foreground">{String(entry.metadata.reason)}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                    <TableCell>{entry.actor.name || entry.actor.email || "System"}</TableCell>
                    <TableCell className="text-right font-medium">{formatLedgerAmount(entry.type, entry.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
