import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, CreditCard, Calendar, Users, AlertTriangle } from "lucide-react";
import { format, addDays } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface SubscriptionPlan {
  id: number;
  name: string;
  displayName: string;
}

interface SubscriptionInfo {
  id: number;
  planId: number;
  planName: string;
  planDisplayName: string;
  seats: number;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  adminOverride: boolean;
}

interface SubscriptionTabProps {
  orgId: number;
  subscription: SubscriptionInfo | null;
  plans: SubscriptionPlan[];
  isLoading: boolean;
}

export default function SubscriptionTab({
  orgId,
  subscription,
  plans,
  isLoading,
}: SubscriptionTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [seats, setSeats] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [extendDays, setExtendDays] = useState<string>("");
  const [reason, setReason] = useState("");

  // Initialize form values when subscription data loads
  useEffect(() => {
    if (subscription) {
      setSelectedPlanId(subscription.planId.toString());
      setSeats(subscription.seats.toString());
      setStatus(subscription.status);
    }
  }, [subscription]);

  const overrideMutation = useMutation({
    mutationFn: async (data: {
      planId?: number;
      seats?: number;
      status?: string;
      extendDays?: number;
      reason: string;
    }) => {
      const res = await apiRequest("POST", `/api/admin/subscriptions/${subscription?.id}/override`, data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update subscription");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "org-subscription", orgId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "org-audit-log", orgId] });
      toast({
        title: "Subscription updated",
        description: "The subscription has been updated successfully.",
      });
      setExtendDays("");
      setReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApplyChanges = () => {
    if (!reason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for this change.",
        variant: "destructive",
      });
      return;
    }

    const updates: any = { reason };

    if (selectedPlanId && selectedPlanId !== subscription?.planId.toString()) {
      updates.planId = parseInt(selectedPlanId);
    }
    if (seats && parseInt(seats) !== subscription?.seats) {
      updates.seats = parseInt(seats);
    }
    if (status && status !== subscription?.status) {
      updates.status = status;
    }
    if (extendDays && parseInt(extendDays) > 0) {
      updates.extendDays = parseInt(extendDays);
    }

    if (Object.keys(updates).length === 1) {
      toast({
        title: "No changes",
        description: "Please make at least one change before applying.",
        variant: "destructive",
      });
      return;
    }

    overrideMutation.mutate(updates);
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
            <p>This organization has no subscription.</p>
            <p className="text-sm mt-2">Create a subscription first to manage it.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const periodEnd = new Date(subscription.currentPeriodEnd);
  const newPeriodEnd = extendDays ? addDays(periodEnd, parseInt(extendDays) || 0) : null;

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium flex items-center gap-2">
                {subscription.planDisplayName}
                {subscription.adminOverride && (
                  <Badge variant="outline" className="text-xs">Admin Override</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Seats</dt>
              <dd className="font-medium flex items-center gap-1">
                <Users className="h-4 w-4" />
                {subscription.seats}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={subscription.status === 'active' ? 'default' : 'destructive'}>
                  {subscription.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Period End</dt>
              <dd className="font-medium flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(periodEnd, "MMM d, yyyy")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Override Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Override Subscription</CardTitle>
          <CardDescription>
            Make administrative changes to this subscription. All changes are logged in the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Plan Selector */}
            <div className="space-y-2">
              <Label>Plan</Label>
              <Select
                value={selectedPlanId || subscription.planId.toString()}
                onValueChange={setSelectedPlanId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select plan..." />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id.toString()}>
                      {plan.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Seats */}
            <div className="space-y-2">
              <Label>Seats</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={seats || subscription.seats}
                onChange={(e) => setSeats(e.target.value)}
              />
            </div>

            {/* Status */}
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={status || subscription.status}
                onValueChange={setStatus}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trialing">Trialing</SelectItem>
                  <SelectItem value="past_due">Past Due</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Extend Period */}
            <div className="space-y-2">
              <Label>Extend Period (days)</Label>
              <Input
                type="number"
                min={0}
                max={365}
                placeholder="0"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
              />
              {newPeriodEnd && parseInt(extendDays) > 0 && (
                <p className="text-xs text-muted-foreground">
                  New end date: {format(newPeriodEnd, "MMM d, yyyy")}
                </p>
              )}
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label>Reason for Change <span className="text-destructive">*</span></Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why this change is being made..."
              rows={2}
            />
          </div>

          {/* Apply Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleApplyChanges}
              disabled={overrideMutation.isPending || !reason.trim()}
            >
              {overrideMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Apply Changes
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
