import { useState } from "react";
import {
  useCommercialConfig,
  useCreateCheckout,
  calculateTaxAmount,
  calculateTotalWithTax,
  formatPriceINR,
} from "@/hooks/use-subscription";
import { useOnboardingStatus } from "@/hooks/use-onboarding-status";
import { useToast } from "@/hooks/use-toast";
import { initiateCashfreeCheckout } from "@/lib/cashfree";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  Users,
  Building2,
  Zap,
  Loader2,
  ArrowRight,
  CreditCard,
} from "lucide-react";

interface PlanSelectionStepProps {
  onComplete: () => void;
}

export default function PlanSelectionStep({ onComplete }: PlanSelectionStepProps) {
  const { data: commercialConfig, isLoading: plansLoading } = useCommercialConfig();
  const { completeOnboardingAsync, isCompleting } = useOnboardingStatus();
  const createCheckout = useCreateCheckout();
  const { toast } = useToast();

  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [seats, setSeats] = useState(1);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const plans = commercialConfig?.plans;
  const creditPackConfig = commercialConfig?.creditPack;
  const billingConfig = commercialConfig?.billing;
  const freePlan = plans?.find(p => p.name === 'free') as any;
  const proPlan = plans?.find(p => p.name === 'pro') as any;
  const freePlanCard = commercialConfig?.planCards?.free;
  const proPlanCard = commercialConfig?.planCards?.pro;
  const businessPlanCard = commercialConfig?.planCards?.business;
  const creditPackLabel = creditPackConfig
    ? `Add ${creditPackConfig.creditsPerPack}-credit top-ups at ${formatPriceINR(creditPackConfig.pricePerPack)}`
    : 'Extra credit packs available';
  const gstRate = billingConfig?.gstRate || 0;
  const taxEnabled = !!billingConfig?.taxEnabled;
  const subtotal = proPlan
    ? (billingCycle === 'monthly' ? proPlan.pricePerSeatMonthly : proPlan.pricePerSeatAnnual) * seats
    : 0;
  const gstAmount = calculateTaxAmount(subtotal, gstRate);
  const totalWithTax = calculateTotalWithTax(subtotal, gstRate);
  const formatMetric = (value?: number | null) => {
    if (typeof value !== "number" || value <= 0) {
      return "â€”";
    }
    return String(value);
  };

  // Dynamic values from API
  const freeCredits = freePlan?.rateLimits?.monthlyCredits;
  const proCredits = proPlan?.rateLimits?.monthlyCredits;

  const handleSelectFree = async () => {
    try {
      await completeOnboardingAsync();
      toast({
        title: "Welcome to ealana!",
        description: "You're all set up with the Free plan.",
      });
      onComplete();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to complete onboarding",
        variant: "destructive",
      });
    }
  };

  const handleSelectPro = () => {
    setCheckoutDialogOpen(true);
  };

  const handleCheckout = async () => {
    if (!proPlan) return;

    try {
      const result = await createCheckout.mutateAsync({
        planId: proPlan.id,
        seats,
        billingCycle,
      });

      // Mark onboarding as complete before redirecting
      // Don't await - we want to redirect immediately while this completes in background
      completeOnboardingAsync().catch(() => {
        // Ignore errors - payment is more important
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

  const handleContactSales = async () => {
    // Mark onboarding complete, but don't block on it
    completeOnboardingAsync().catch(() => {
      // Ignore errors
    });
    window.location.href = 'mailto:sales@ealana.com?subject=ealana%20Business%20Plan%20Inquiry';
  };

  if (plansLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
          <CreditCard className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground">
          Choose Your Plan
        </h2>
        <p className="text-muted-foreground mt-1">
          Start free or unlock more with Growth
        </p>
      </div>

      {/* Plan Cards */}
      <div className="grid gap-4">
        {/* Free Plan */}
        <div className="p-5 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Users className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Free</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {freePlanCard?.summary || "Perfect for getting started"}
              </p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {(freePlanCard?.highlights ?? [
                  `${formatMetric(freeCredits)} AI credits per month`,
                  "Up to 5 active jobs",
                  "Basic Flow features",
                ]).slice(0, 3).map((highlight) => (
                  <li key={highlight} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    {highlight}
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-right ml-4">
              <div className="text-2xl font-bold text-foreground">
                {formatPriceINR(0)}
              </div>
              <p className="text-xs text-muted-foreground">forever</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={handleSelectFree}
                disabled={isCompleting}
              >
                {isCompleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Get Started'
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Growth Plan - Highlighted */}
        <div className="p-5 rounded-xl border-2 border-primary bg-card relative">
          <Badge className="absolute -top-2.5 left-4 bg-primary text-primary-foreground">
            Recommended
          </Badge>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-foreground">Growth</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {proPlanCard?.summary || "For growing teams"}
              </p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {(proPlanCard?.highlights ?? []).slice(0, 5).map((highlight) => (
                  <li key={highlight} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-green-500" />
                    {highlight.includes("top-ups") ? creditPackLabel : highlight}
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-right ml-4">
              <div className="text-2xl font-bold text-foreground">
                {proPlan ? formatPriceINR(proPlan.pricePerSeatMonthly) : '...'}
              </div>
              <p className="text-xs text-muted-foreground">/seat/month</p>
              <Button
                className="mt-3"
                onClick={handleSelectPro}
              >
                Upgrade
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>

        {/* Business Plan */}
        <div className="p-5 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold text-foreground">Business</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                {businessPlanCard?.summary || "For large organizations"}
              </p>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Custom AI credits
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  Dedicated instance
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  SLA guarantee
                </li>
              </ul>
            </div>
            <div className="text-right ml-4">
              <div className="text-2xl font-bold text-foreground">
                Custom
              </div>
              <p className="text-xs text-muted-foreground">tailored pricing</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={handleContactSales}
              >
                Contact Sales
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
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
                Growth includes {formatMetric(proCredits)} AI credits per seat per month, pooled across your organization. With {seats} seat{seats === 1 ? "" : "s"}, that is {proCredits * seats} included credits per month. {commercialConfig?.seatPolicies?.seatAddCredits.summary} {creditPackConfig ? `Extra ${creditPackConfig.creditsPerPack}-credit packs are available at ${formatPriceINR(creditPackConfig.pricePerPack)}.` : 'Extra credit packs are available.'}
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
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex justify-between text-sm">
                  <span>Subtotal</span>
                  <span>{formatPriceINR(subtotal)}</span>
                </div>
                {taxEnabled && (
                  <div className="mt-2 flex justify-between text-sm">
                    <span>GST ({gstRate}%)</span>
                    <span>{formatPriceINR(gstAmount)}</span>
                  </div>
                )}
                <div className="mt-2 flex justify-between">
                  <span>Total</span>
                  <span className="font-bold">
                    {formatPriceINR(totalWithTax)}
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
            <Button variant="outline" onClick={() => setCheckoutDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCheckout} disabled={createCheckout.isPending}>
              {createCheckout.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Continue to Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
