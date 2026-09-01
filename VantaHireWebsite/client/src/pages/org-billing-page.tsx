import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { initiateCashfreeCheckout } from "@/lib/cashfree";
import {
  useSubscription,
  useCommercialConfig,
  useSeatUsage,
  useInvoices,
  useOrderStatus,
  useCreateCheckout,
  useCreateCreditPackCheckout,
  useCancelSubscription,
  useReactivateSubscription,
  calculateTaxAmount,
  calculateTotalWithTax,
  formatPriceINR,
} from "@/hooks/use-subscription";
import { useOrganization } from "@/hooks/use-organization";
import { useAiCredits, useAiCreditUsage } from "@/hooks/use-ai-credits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard,
  Users,
  Sparkles,
  Download,
  AlertCircle,
  Check,
  Loader2,
  Calendar,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { orgBillingPageCopy } from "@/lib/internal-copy";

export default function OrgBillingPage() {
  const queryClient = useQueryClient();
  const { data: orgData } = useOrganization();
  const isOwner = orgData?.membership?.role === 'owner';
  const { data: subscription, isLoading: subLoading } = useSubscription();
  const { data: commercialConfig, isLoading: commercialConfigLoading } = useCommercialConfig();
  const { data: seatUsage, isLoading: seatUsageLoading } = useSeatUsage();
  const { data: invoices, isLoading: invoicesLoading } = useInvoices(isOwner);
  const { data: credits, isLoading: creditsLoading } = useAiCredits();
  const { data: creditUsage, isLoading: creditUsageLoading } = useAiCreditUsage(isOwner);
  const createCheckout = useCreateCheckout();
  const createCreditPackCheckout = useCreateCreditPackCheckout();
  const cancelSubscription = useCancelSubscription();
  const reactivateSubscription = useReactivateSubscription();
  const { toast } = useToast();

  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [creditPackDialogOpen, setCreditPackDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [creditPackQuantity, setCreditPackQuantity] = useState("1");
  const [returnedOrderId, setReturnedOrderId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("order_id");
  });
  const [hasRefreshedForOrder, setHasRefreshedForOrder] = useState(false);

  const plans = commercialConfig?.plans;
  const billingConfig = commercialConfig?.billing;
  const creditPackConfig = commercialConfig?.creditPack;
  const freePlan = plans?.find(p => p.name === 'free') as any;
  const proPlan = plans?.find(p => p.name === 'pro') as any;
  const freePlanCard = commercialConfig?.planCards?.free;
  const proPlanCard = commercialConfig?.planCards?.pro;
  const orderStatus = useOrderStatus(returnedOrderId);
  const currentPlanName = subscription?.plan?.displayName || 'Free';
  const isPro = subscription?.plan?.name === 'pro';
  const proCreditsPerSeat = proPlan?.rateLimits?.monthlyCredits || 0;
  const currentIncludedCredits = isPro
    ? proCreditsPerSeat * Math.max(1, subscription?.seats || 1)
    : (freePlan?.rateLimits?.monthlyCredits || 0);
  const selectedPlanIncludedCredits = proCreditsPerSeat * Math.max(1, seats);
  const creditPackQuantityNumber = Math.min(
    creditPackConfig?.maxQuantity || 10,
    Math.max(1, parseInt(creditPackQuantity || "1", 10) || 1),
  );
  const creditPackTotalCredits = creditPackConfig ? creditPackConfig.creditsPerPack * creditPackQuantityNumber : 0;
  const creditPackTotalPrice = creditPackConfig ? creditPackConfig.pricePerPack * creditPackQuantityNumber : 0;
  const gstRate = billingConfig?.gstRate || 0;
  const taxEnabled = !!billingConfig?.taxEnabled;
  const upgradeSubtotal = proPlan
    ? (billingCycle === 'monthly' ? proPlan.pricePerSeatMonthly : proPlan.pricePerSeatAnnual) * seats
    : 0;
  const upgradeTaxAmount = calculateTaxAmount(upgradeSubtotal, gstRate);
  const upgradeTotal = calculateTotalWithTax(upgradeSubtotal, gstRate);
  const creditPackTaxAmount = calculateTaxAmount(creditPackTotalPrice, gstRate);
  const creditPackGrandTotal = calculateTotalWithTax(creditPackTotalPrice, gstRate);
  const creditPackLabel = creditPackConfig
    ? `Add ${creditPackConfig.creditsPerPack}-credit top-ups from ${formatPriceINR(creditPackConfig.pricePerPack)}`
    : "Extra credit packs available";
  const formatMetric = (value?: number | null) => {
    if (typeof value !== "number" || value <= 0) {
      return "—";
    }
    return String(value);
  };
  const currentPeriodEndDate = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
  const hasValidCurrentPeriodEnd = !!currentPeriodEndDate && !Number.isNaN(currentPeriodEndDate.getTime());
  const seatAddCreditsSummary = commercialConfig?.seatPolicies?.seatAddCredits?.summary;

  const handleUpgrade = async () => {
    if (!selectedPlan) return;

    try {
      const result = await createCheckout.mutateAsync({
        planId: selectedPlan,
        seats,
        billingCycle,
      });

      if (result.sessionId) {
        // Use Cashfree SDK for checkout (required for production)
        await initiateCashfreeCheckout(result.sessionId, result.paymentLink);
      } else if (result.paymentLink) {
        // Fallback to direct redirect (works in sandbox)
        window.location.href = result.paymentLink;
      } else {
        toast({
          title: "Error",
          description: "Failed to create checkout session",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start checkout",
        variant: "destructive",
      });
    }
  };

  const handleCancel = async () => {
    try {
      await cancelSubscription.mutateAsync();
      toast({
        title: "Subscription cancelled",
        description: "Your subscription will end at the current billing period.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to cancel subscription",
        variant: "destructive",
      });
    }
  };

  const handleReactivate = async () => {
    try {
      await reactivateSubscription.mutateAsync();
      toast({
        title: "Subscription reactivated",
        description: "Your subscription has been reactivated.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to reactivate subscription",
        variant: "destructive",
      });
    }
  };

  const handleCreditPackCheckout = async () => {
    if (!creditPackConfig) return;

    try {
      const result = await createCreditPackCheckout.mutateAsync({
        quantity: creditPackQuantityNumber,
      });

      if (result.sessionId) {
        await initiateCashfreeCheckout(result.sessionId, result.paymentLink);
      } else if (result.paymentLink) {
        window.location.href = result.paymentLink;
      } else {
        toast({
          title: "Error",
          description: "Failed to create credit pack checkout session",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start credit pack checkout",
        variant: "destructive",
      });
    }
  };

  const formatInvoiceType = (type: string) => {
    if (type === 'subscription') return 'Subscription';
    if (type === 'seat_addition') return 'Seat addition';
    if (type === 'credit_pack') return 'Credit pack';
    return type;
  };

  const clearReturnedOrder = () => {
    setReturnedOrderId(null);
    setHasRefreshedForOrder(false);
    const params = new URLSearchParams(window.location.search);
    params.delete("order_id");
    params.delete("type");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  };

  const reopenOrderFlow = () => {
    const type = orderStatus.data?.type;
    if (type === 'credit_pack' && isOwner && isPro && creditPackConfig) {
      setCreditPackDialogOpen(true);
      return;
    }
    if (type === 'subscription' && isOwner && proPlan?.id) {
      setSelectedPlan(proPlan.id);
      setUpgradeDialogOpen(true);
    }
  };

  const creditUsagePercent = credits && credits.allocated > 0
    ? Math.min(100, Math.round((credits.used / credits.allocated) * 100))
    : 0;
  const isPlanSectionLoading = subLoading || commercialConfigLoading || seatUsageLoading;
  const isCreditsSectionLoading = creditsLoading || (isOwner && creditUsageLoading);
  const showCreditsSection = isCreditsSectionLoading || !!credits;
  const showInvoicesSection = isOwner && (invoicesLoading || !!invoices?.length);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    const orderId = params.get("order_id");

    if (orderId !== returnedOrderId) {
      setReturnedOrderId(orderId);
      setHasRefreshedForOrder(false);
    }

    if (params.get("buy_credits") === "1" && isOwner && isPro && creditPackConfig) {
      setCreditPackDialogOpen(true);
      params.delete("buy_credits");
      changed = true;
    }

    if (params.get("upgrade") === "growth" && isOwner && !isPro && proPlan?.id) {
      setSelectedPlan(proPlan.id);
      setUpgradeDialogOpen(true);
      params.delete("upgrade");
      changed = true;
    }

    if (changed) {
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [creditPackConfig, isOwner, isPro, proPlan?.id, returnedOrderId]);

  useEffect(() => {
    if (orderStatus.data?.status !== 'completed' || hasRefreshedForOrder) {
      return;
    }

    setHasRefreshedForOrder(true);
    queryClient.invalidateQueries({ queryKey: ['subscription'] });
    queryClient.invalidateQueries({ queryKey: ['ai', 'credits'] });
    queryClient.invalidateQueries({ queryKey: ['subscription', 'invoices'] });
  }, [hasRefreshedForOrder, orderStatus.data?.status, queryClient]);

  return (
    <Layout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{orgBillingPageCopy.header.title}</h1>
        <p className="text-muted-foreground">
          {orgBillingPageCopy.header.subtitle}
        </p>
      </div>

      {returnedOrderId && (
        <Card className={
          orderStatus.data?.status === 'completed'
            ? 'border-green-200 bg-green-50'
            : orderStatus.data?.status === 'failed'
              ? 'border-red-200 bg-red-50'
              : 'border-amber-200 bg-amber-50'
        }>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                {orderStatus.isLoading || orderStatus.data?.status === 'pending' ? (
                  <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-amber-600" />
                ) : (
                  <AlertCircle
                    className={`mt-0.5 h-5 w-5 ${
                      orderStatus.data?.status === 'completed' ? 'text-green-600' : 'text-red-600'
                    }`}
                  />
                )}
                <div className="space-y-1">
                  <p className="font-medium">
                    {orderStatus.isLoading || orderStatus.data?.status === 'pending'
                      ? 'Payment is being processed'
                      : orderStatus.data?.status === 'completed'
                        ? 'Payment completed'
                        : 'Payment did not complete'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {orderStatus.isLoading || orderStatus.data?.status === 'pending'
                      ? 'We are checking the latest payment status. This page refreshes automatically while the order is pending.'
                      : orderStatus.data?.status === 'completed'
                        ? `${formatInvoiceType(orderStatus.data?.type || 'subscription')} payment received${orderStatus.data?.paymentMethod ? ` via ${orderStatus.data.paymentMethod}` : ''}.`
                        : orderStatus.data?.failureReason || 'Please start a new payment from billing if you still want to continue.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Order ID: {returnedOrderId}
                    {typeof orderStatus.data?.totalAmount === 'number' ? ` • ${formatPriceINR(orderStatus.data.totalAmount)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {orderStatus.data?.downloadPath && orderStatus.data.status === 'completed' && (
                  <Button variant="outline" asChild>
                    <a href={orderStatus.data.downloadPath} target="_blank" rel="noopener noreferrer">
                      <Download className="mr-2 h-4 w-4" />
                      Download Invoice
                    </a>
                  </Button>
                )}
                {orderStatus.data?.status === 'failed' && (orderStatus.data.type === 'subscription' || orderStatus.data.type === 'credit_pack') && (
                  <Button variant="outline" onClick={reopenOrderFlow}>
                    Try Again
                  </Button>
                )}
                <Button variant="ghost" onClick={clearReturnedOrder}>
                  Dismiss
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current Plan</CardTitle>
              <CardDescription>
                {isPro ? "Growth subscription" : "Free plan"}
              </CardDescription>
            </div>
            <Badge variant={isPro ? "default" : "secondary"} className="text-lg px-3 py-1">
              {currentPlanName}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isPlanSectionLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-lg bg-slate-50 p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : subscription ? (
            <div className="grid md:grid-cols-3 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Users className="h-4 w-4" />
                  <span className="text-sm">Seats</span>
                </div>
                <p className="text-2xl font-bold">{seatUsage?.assigned || 1} / {seatUsage?.purchased || 1}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm">Billing Cycle</span>
                </div>
                <p className="text-2xl font-bold capitalize">{subscription.billingCycle}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <CreditCard className="h-4 w-4" />
                  <span className="text-sm">{isPro ? "Current Paid Term Ends" : "Free Plan Active"}</span>
                </div>
                <p className="text-lg font-bold">
                  {hasValidCurrentPeriodEnd ? format(currentPeriodEndDate, 'MMM d, yyyy') : "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Billing details will appear once subscription data is available.
            </div>
          )}

          {subscription?.status === 'past_due' && (
            <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-medium text-amber-800">Payment Failed</p>
                <p className="text-sm text-amber-700">
                  Start a new payment from billing before your paid term ends to avoid service interruption.
                </p>
              </div>
            </div>
          )}

          {subscription?.cancelAtPeriodEnd && (
            <div className="flex items-center gap-3 p-4 bg-slate-50 border rounded-lg">
              <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Cancellation Scheduled</p>
                <p className="text-sm text-muted-foreground">
                  Your paid Growth access will end on {hasValidCurrentPeriodEnd ? format(currentPeriodEndDate, 'MMM d, yyyy') : "—"}
                </p>
              </div>
              {isOwner && (
                <Button variant="outline" size="sm" onClick={handleReactivate}>
                  Reactivate
                </Button>
              )}
            </div>
          )}
        </CardContent>
        {isOwner && !isPro && (
          <CardFooter className="border-t pt-6">
            <Button onClick={() => {
              setSelectedPlan(proPlan?.id || null);
              setUpgradeDialogOpen(true);
            }}>
              Upgrade to Growth
            </Button>
          </CardFooter>
        )}
        {isOwner && isPro && !subscription?.cancelAtPeriodEnd && (
          <CardFooter className="border-t pt-6">
            <Button variant="outline" onClick={handleCancel}>
              Cancel Subscription
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* AI Credits */}
      {showCreditsSection && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Credits
            </CardTitle>
            <CardDescription>
              Your organization's shared AI credit pool
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isCreditsSectionLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-20 w-full rounded-lg" />
                <Skeleton className="h-2 w-full" />
                <div className="grid gap-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <Skeleton key={index} className="h-20 w-full rounded-lg" />
                  ))}
                </div>
                <Skeleton className="h-40 w-full rounded-lg" />
              </div>
            ) : credits ? (
              <>
            {creditUsagePercent >= 50 && (
              <div className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
                creditUsagePercent >= 100
                  ? "border-red-200 bg-red-50"
                  : creditUsagePercent >= 75
                    ? "border-amber-200 bg-amber-50"
                    : "border-yellow-200 bg-yellow-50"
              }`}>
                <div className="flex items-start gap-3">
                  <AlertCircle className={`mt-0.5 h-5 w-5 ${
                    creditUsagePercent >= 100 ? "text-red-600" : "text-amber-600"
                  }`} />
                  <div>
                    <p className="font-medium">
                      {creditUsagePercent >= 100
                        ? "AI credits exhausted"
                        : `${creditUsagePercent}% of AI credits used`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isPro
                        ? "Your organization is close to its shared AI credit limit for this term. Buy more credits if you need more AI usage."
                        : "Your Free plan is close to its AI credit limit. Upgrade to Growth for more included credits and top-ups."}
                    </p>
                  </div>
                </div>
                {isOwner && (
                  isPro ? (
                    <Button variant="outline" onClick={() => setCreditPackDialogOpen(true)}>
                      Buy More Credits
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelectedPlan(proPlan?.id || null);
                        setUpgradeDialogOpen(true);
                      }}
                    >
                      Upgrade to Growth
                    </Button>
                  )
                )}
              </div>
            )}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>{credits.used} used</span>
                <span>{credits.remaining} remaining</span>
              </div>
              <Progress value={creditUsagePercent} className="h-2" />
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Current cycle credit pool: {credits.allocated} credits</span>
              {credits.rollover > 0 && (
                <span>+{credits.rollover} rolled over</span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              Included credits this term: {currentIncludedCredits}
              {isPro ? ` (${proCreditsPerSeat} per seat × ${subscription?.seats || 1} seat${(subscription?.seats || 1) === 1 ? '' : 's'})` : ""}
            </div>
            {isOwner && creditUsage && (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Organization AI activity</p>
                  <p className="text-sm text-muted-foreground">
                    Informational totals for the last {creditUsage.windowDays} days. This is not a credit ledger or balance.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Operations</p>
                  <p className="text-lg font-semibold">{creditUsage.totals.operations.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Input tokens</p>
                  <p className="text-lg font-semibold">{creditUsage.totals.tokensIn.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Output tokens</p>
                  <p className="text-lg font-semibold">{creditUsage.totals.tokensOut.toLocaleString()}</p>
                </div>
                </div>
                {creditUsage.byKind.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Operation</TableHead>
                        <TableHead className="text-right">Runs</TableHead>
                        <TableHead className="text-right">Input tokens</TableHead>
                        <TableHead className="text-right">Output tokens</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {creditUsage.byKind.map((entry) => (
                        <TableRow key={entry.kind}>
                          <TableCell className="font-medium">{entry.kind.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-right">{entry.operations.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{entry.tokensIn.toLocaleString()}</TableCell>
                          <TableCell className="text-right">{entry.tokensOut.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
            {credits.purchasedCredits && credits.purchasedCredits > 0 && (
              <div className="text-sm text-muted-foreground">
                Purchased credits available: {credits.purchasedCredits}
              </div>
            )}
            {isOwner && isPro && creditPackConfig && (
              <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                <div>
                  <p className="font-medium">Need more AI credits?</p>
                  <p className="text-sm text-muted-foreground">
                    Buy extra packs of {creditPackConfig.creditsPerPack} credits for {formatPriceINR(creditPackConfig.pricePerPack)} each.
                  </p>
                </div>
                <Button onClick={() => setCreditPackDialogOpen(true)}>
                  Buy More Credits
                </Button>
              </div>
            )}
              </>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                AI credit details will appear once your organization uses or is allocated credits.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Plan Comparison */}
      {!isPro && proPlan && (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade to Growth</CardTitle>
            <CardDescription>
              Unlock advanced features and more AI credits
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold mb-3">Free</h3>
                <ul className="space-y-2 text-sm">
                  {(freePlanCard?.highlights ?? [
                    "1 seat (fixed)",
                    `${formatMetric(freePlan?.rateLimits?.monthlyCredits)} AI credits/month`,
                    `${formatMetric(freePlan?.rateLimits?.dailyRateLimit)} AI analyses/day`,
                    "Basic Flow features",
                  ]).slice(0, 4).map((highlight) => (
                    <li key={highlight} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      {highlight}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-4 border-2 border-primary rounded-lg relative">
                <Badge className="absolute -top-2 right-4">Popular</Badge>
                <h3 className="font-semibold mb-3">Growth</h3>
                <p className="text-2xl font-bold mb-3">
                  {formatPriceINR(proPlan.pricePerSeatMonthly)}
                  <span className="text-sm font-normal text-muted-foreground">/seat/month</span>
                </p>
                <ul className="space-y-2 text-sm">
                  {([
                    ...(proPlanCard?.highlights ?? []),
                    `${formatMetric(proPlan?.rateLimits?.dailyRateLimit)} AI analyses/day`,
                    "All features included",
                  ]).slice(0, 5).map((highlight) => (
                    <li key={highlight} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      {highlight.includes("top-ups") ? creditPackLabel : highlight}
                    </li>
                  ))}
                </ul>
                {isOwner && (
                  <Button
                    className="w-full mt-4"
                    onClick={() => {
                      setSelectedPlan(proPlan.id);
                      setUpgradeDialogOpen(true);
                    }}
                  >
                    Upgrade to Growth
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoices */}
      {showInvoicesSection && (
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {invoicesLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : invoices && invoices.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell>{formatInvoiceType(invoice.type)}</TableCell>
                    <TableCell>
                      {format(new Date(invoice.completedAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>{formatPriceINR(invoice.totalAmount)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={invoice.downloadPath} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Invoices will appear here after your first successful billing event.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upgrade Dialog */}
      <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upgrade to Growth</DialogTitle>
            <DialogDescription>
              Choose your seat count and billing cycle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Number of Seats</Label>
              <Input
                type="number"
                min={1}
                max={1000}
                value={seats}
                onChange={(e) => setSeats(parseInt(e.target.value) || 1)}
              />
              <p className="text-sm text-muted-foreground">
                Growth includes {formatMetric(proCreditsPerSeat)} AI credits per seat per month, pooled across your organization. With {seats} seat{seats === 1 ? "" : "s"}, that is {selectedPlanIncludedCredits} included credits per month. {seatAddCreditsSummary ?? "Seat additions include prorated credits for the remainder of the term."} {creditPackConfig ? `Extra ${creditPackConfig.creditsPerPack}-credit packs can be added anytime.` : 'Extra credit packs can be added anytime.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Billing Cycle</Label>
              <Select value={billingCycle} onValueChange={(v: 'monthly' | 'annual') => setBillingCycle(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="annual">Annual (Save 17%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {proPlan && (
              <div className="p-4 bg-slate-50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatPriceINR(upgradeSubtotal)}</span>
                </div>
                {taxEnabled && (
                  <div className="mt-2 flex justify-between text-sm">
                    <span>GST ({gstRate}%)</span>
                    <span>{formatPriceINR(upgradeTaxAmount)}</span>
                  </div>
                )}
                <div className="mt-2 flex justify-between">
                  <span>Total</span>
                  <span className="font-bold">
                    {formatPriceINR(upgradeTotal)}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{billingCycle === 'monthly' ? 'month' : 'year'}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {taxEnabled
                    ? `GST (${gstRate}%) is added at checkout.`
                    : 'No additional tax is configured.'}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpgrade} disabled={createCheckout.isPending}>
              {createCheckout.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Continue to Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={creditPackDialogOpen} onOpenChange={setCreditPackDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buy More Credits</DialogTitle>
            <DialogDescription>
              Purchase extra AI credits for your organization. Included monthly credits are used first, then purchased credits.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Pack Quantity</Label>
              <Input
                type="number"
                min={1}
                max={creditPackConfig?.maxQuantity || 10}
                value={creditPackQuantity}
                onChange={(e) => setCreditPackQuantity(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {creditPackConfig
                  ? `1 pack = ${creditPackConfig.creditsPerPack} credits = ${formatPriceINR(creditPackConfig.pricePerPack)}`
                  : 'Pack pricing will be shown at checkout'}
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span>Credits to add</span>
                <span className="font-medium">{creditPackTotalCredits}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Pack quantity</span>
                <span className="font-medium">{creditPackQuantityNumber}</span>
              </div>
              <div className="flex justify-between">
                <span>Total</span>
                <span className="font-bold">{formatPriceINR(creditPackTotalPrice)}</span>
              </div>
              {taxEnabled && (
                <div className="flex justify-between text-sm">
                  <span>GST ({gstRate}%)</span>
                  <span>{formatPriceINR(creditPackTaxAmount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Grand total</span>
                <span className="font-bold">{formatPriceINR(creditPackGrandTotal)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {taxEnabled
                  ? `GST (${gstRate}%) is added at checkout.`
                  : 'No additional tax is configured.'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditPackDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreditPackCheckout} disabled={createCreditPackCheckout.isPending}>
              {createCreditPackCheckout.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Continue to Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </Layout>
  );
}
