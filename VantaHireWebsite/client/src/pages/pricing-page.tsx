import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import {
  useCommercialConfig,
  useSubscription,
  useCreateCheckout,
  calculateTaxAmount,
  calculateTotalWithTax,
  formatPriceINR,
} from "@/hooks/use-subscription";
import { initiateCashfreeCheckout } from "@/lib/cashfree";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import {
  Check,
  X,
  Users,
  Building2,
  Zap,
  Loader2,
  ArrowRight,
  Mail,
  AlertCircle,
} from "lucide-react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/pricing.css";

// Grid Overlay (same as homepage)
const GridOverlay = () => (
  <div className="hr-page-grid-overlay">
    <div className="hr-page-grid-overlay-inner">
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
      <div className="grid-col"></div>
      <div className="grid-col"></div>
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
    </div>
  </div>
);

export default function PricingPage() {
  const { user } = useAuth();
  const { data: organization } = useOrganization();
  const { data: commercialConfig } = useCommercialConfig();
  const { data: subscription } = useSubscription();
  const createCheckout = useCreateCheckout();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isVisible, setIsVisible] = useState(false);

  const [checkoutDialogOpen, setCheckoutDialogOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [seats, setSeats] = useState(1);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  // Public checkout fields (for non-logged-in users)
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [gstin, setGstin] = useState('');
  const [checkoutMode, setCheckoutMode] = useState<'public' | 'create-org' | 'existing'>('public');
  const [requiresLogin, setRequiresLogin] = useState(false);

  const plans = commercialConfig?.plans;
  const creditPackConfig = commercialConfig?.creditPack;
  const billingConfig = commercialConfig?.billing;
  const freePlan = plans?.find(p => p.name === 'free') as any;
  const proPlan = plans?.find(p => p.name === 'pro') as any;
  const freePlanCard = commercialConfig?.planCards?.free;
  const proPlanCard = commercialConfig?.planCards?.pro;
  const businessPlanCard = commercialConfig?.planCards?.business;
  const isLoggedIn = !!user;
  const hasOrg = !!organization;
  const isOwner = organization?.membership?.role === 'owner';
  const currentPlan = subscription?.plan?.name || 'free';
  const isPro = currentPlan === 'pro';
  const creditPackLabel = creditPackConfig
    ? `Add extra ${creditPackConfig.creditsPerPack}-credit packs at ${formatPriceINR(creditPackConfig.pricePerPack)}`
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
      return "—";
    }
    return String(value);
  };

  // Dynamic plan values from API
  const freeCredits = freePlan?.rateLimits?.monthlyCredits;
  const proCredits = proPlan?.rateLimits?.monthlyCredits;
  const comparisonRows = commercialConfig?.comparisonRows ?? [];
  const faqs = commercialConfig?.faqs ?? [];

  // Mutation for public checkout
  const publicCheckout = useMutation({
    mutationFn: async (data: { email: string; orgName: string; planId: number; seats: number; billingCycle: 'monthly' | 'annual'; gstin?: string }) => {
      const res = await fetch('/api/subscription/checkout-public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create checkout');
      }
      return res.json();
    },
  });

  // Mutation for create-org checkout (requires CSRF token since it's authenticated)
  const createOrgCheckout = useMutation({
    mutationFn: async (data: { orgName: string; planId: number; seats: number; billingCycle: 'monthly' | 'annual'; gstin?: string }) => {
      // Fetch CSRF token first
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.token;

      const res = await fetch('/api/subscription/checkout-create-org', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create checkout');
      }
      return res.json();
    },
  });

  useEffect(() => { setIsVisible(true); }, []);

  const handleSelectPro = () => {
    if (!proPlan) return;

    setSelectedPlan(proPlan.id);
    setRequiresLogin(false);

    // Determine checkout mode based on user state
    if (!isLoggedIn) {
      // Case 1: Not logged in - public checkout
      setCheckoutMode('public');
      setEmail('');
      setOrgName('');
    } else if (!hasOrg) {
      // Case 3: Logged in but no org - create org + checkout
      setCheckoutMode('create-org');
      setOrgName('');
    } else if (isOwner) {
      // Case 2: Logged in with org, is owner - existing checkout
      setCheckoutMode('existing');
    } else {
      // Logged in with org but not owner - can't upgrade
      toast({
        title: "Permission Required",
        description: "Only the organization owner can manage billing. Please contact your organization owner to upgrade.",
        variant: "destructive",
      });
      return;
    }

    setCheckoutDialogOpen(true);
  };

  const handleCheckout = async () => {
    if (!selectedPlan) return;

    try {
      let sessionId: string | undefined;
      let paymentLink: string | undefined;

      if (checkoutMode === 'public') {
        // Validate email and org name
        if (!email || !email.includes('@')) {
          toast({ title: "Error", description: "Please enter a valid email address", variant: "destructive" });
          return;
        }
        if (!orgName || orgName.length < 2) {
          toast({ title: "Error", description: "Please enter an organization name", variant: "destructive" });
          return;
        }

        const result = await publicCheckout.mutateAsync({
          email,
          orgName,
          planId: selectedPlan,
          seats,
          billingCycle,
          ...(gstin ? { gstin } : {}),
        });

        if (result.requiresLogin) {
          setRequiresLogin(true);
          return;
        }

        sessionId = result.sessionId;
        paymentLink = result.paymentLink;
      } else if (checkoutMode === 'create-org') {
        if (!orgName || orgName.length < 2) {
          toast({ title: "Error", description: "Please enter an organization name", variant: "destructive" });
          return;
        }

        const result = await createOrgCheckout.mutateAsync({
          orgName,
          planId: selectedPlan,
          seats,
          billingCycle,
          ...(gstin ? { gstin } : {}),
        });

        sessionId = result.sessionId;
        paymentLink = result.paymentLink;
      } else {
        // Existing org checkout
        const result = await createCheckout.mutateAsync({
          planId: selectedPlan,
          seats,
          billingCycle,
        });

        sessionId = result.sessionId;
        paymentLink = result.paymentLink;
      }

      if (sessionId) {
        // Use Cashfree SDK for checkout (required for production)
        await initiateCashfreeCheckout(sessionId, paymentLink);
      } else if (paymentLink) {
        // Fallback to direct redirect (works in sandbox)
        window.location.href = paymentLink;
      } else {
        toast({
          title: "Error",
          description: "Failed to create checkout session",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      // Handle auth errors specifically
      if (error.message?.includes('401') || error.message?.toLowerCase().includes('auth')) {
        setCheckoutDialogOpen(false);
        setLocation('/recruiter-auth?redirect=/pricing');
        return;
      }
      toast({
        title: "Error",
        description: error.message || "Failed to start checkout",
        variant: "destructive",
      });
    }
  };

  const isCheckoutPending = publicCheckout.isPending || createOrgCheckout.isPending || createCheckout.isPending;

  const handleContactSales = () => {
    window.location.href = 'mailto:sales@vantahire.com?subject=VantaHire%20Business%20Plan%20Inquiry';
  };

  const renderFeatureValue = (value: boolean | string) => {
    if (typeof value === 'boolean') {
      return value ? (
        <span className="hr-comparison-check"><Check size={16} /></span>
      ) : (
        <span className="hr-comparison-x"><X size={16} /></span>
      );
    }
    return <span style={{ color: 'var(--hr-text)' }}>{value}</span>;
  };

  return (
    <>
      <Helmet>
        <title>Pricing | VantaHire - Simple, Transparent Pricing</title>
        <meta name="description" content="Simple pricing. No surprises. Start free, upgrade when your team grows. No long contracts. AI sourcing, WhatsApp outreach, client portal, and pipeline management included." />
        <link rel="canonical" href="https://vantahire.com/pricing" />
        <meta property="og:title" content="Pricing | VantaHire - Simple, Transparent Pricing" />
        <meta property="og:description" content="Simple pricing. No surprises. Start free, upgrade when your team grows." />
        <meta property="og:url" content="https://vantahire.com/pricing" />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="homepage-redesign public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="hr-pricing-hero">
            <div className="hr-section-label">Pricing</div>
            <h1 className="hr-section-title">Simple pricing.<br />No surprises.</h1>
            <p className="hr-section-desc">
              Start free. Upgrade when your team grows. No long contracts. No hidden fees.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="hr-pricing-cards">
            {/* Free Plan */}
            <div className="hr-plan-card">
              <div className="hr-plan-icon" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Users size={18} style={{ color: 'var(--hr-text-muted)' }} />
              </div>
              <div className="hr-plan-name">Free</div>
              <div className="hr-plan-summary">{freePlanCard?.summary || "Get started in minutes"}</div>
              <div className="hr-plan-price">
                {formatPriceINR(0)}
                <span className="hr-plan-period"> /month</span>
              </div>
              <div className="hr-plan-tax-note">&nbsp;</div>
              <div className="hr-plan-divider"></div>
              <ul className="hr-plan-features">
                {(freePlanCard?.highlights ?? []).map((highlight) => (
                  <li key={highlight}>
                    <Check size={16} className="hr-check-icon" />
                    {highlight}
                  </li>
                ))}
              </ul>
              {currentPlan === 'free' && isLoggedIn ? (
                <button className="hr-plan-btn secondary" disabled>Current Plan</button>
              ) : (
                <button className="hr-plan-btn secondary" onClick={() => setLocation('/recruiter-auth')}>
                  Get Started
                </button>
              )}
            </div>

            {/* Growth Plan */}
            <div className="hr-plan-card featured">
              <div className="hr-plan-badge">Most Popular</div>
              <div className="hr-plan-icon" style={{ background: 'rgba(124,58,237,0.15)' }}>
                <Zap size={18} style={{ color: 'var(--hr-accent-hover)' }} />
              </div>
              <div className="hr-plan-name">Growth</div>
              <div className="hr-plan-summary">{proPlanCard?.summary || "Scale your hiring output"}</div>
              <div className="hr-plan-price">
                {proPlan ? formatPriceINR(proPlan.pricePerSeatMonthly) : '...'}
                <span className="hr-plan-period"> /seat/month</span>
              </div>
              <div className="hr-plan-tax-note">
                {taxEnabled ? `+ GST (${gstRate}%) | Save with annual billing` : 'Save with annual billing'}
              </div>
              <div className="hr-plan-divider"></div>
              <div className="hr-plan-includes">Everything in Free, plus:</div>
              <ul className="hr-plan-features">
                {(proPlanCard?.highlights ?? []).map((highlight) => (
                  <li key={highlight}>
                    <Check size={16} className="hr-check-icon" />
                    {highlight.includes("top-ups") ? creditPackLabel : highlight}
                  </li>
                ))}
              </ul>
              {isPro ? (
                <button className="hr-plan-btn primary" disabled>Current Plan</button>
              ) : (
                <button className="hr-plan-btn primary" onClick={handleSelectPro}>
                  Upgrade to Growth <span className="btn-arrow">&rarr;</span>
                </button>
              )}
            </div>

            {/* Enterprise Plan */}
            <div className="hr-plan-card">
              <div className="hr-plan-icon" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <Building2 size={18} style={{ color: 'var(--hr-text-muted)' }} />
              </div>
              <div className="hr-plan-name">Enterprise</div>
              <div className="hr-plan-summary">{businessPlanCard?.summary || "Custom fit for large teams"}</div>
              <div className="hr-plan-price">Custom</div>
              <div className="hr-plan-tax-note">Tailored to your needs</div>
              <div className="hr-plan-divider"></div>
              <div className="hr-plan-includes">Everything in Growth, plus:</div>
              <ul className="hr-plan-features">
                {(businessPlanCard?.highlights ?? []).slice(1).map((highlight) => (
                  <li key={highlight}>
                    <Check size={16} className="hr-check-icon" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <button className="hr-plan-btn secondary" onClick={handleContactSales}>
                Contact Sales
              </button>
            </div>
          </div>

          {/* Feature Comparison */}
          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">
              <div className="hr-comparison-section">
                <h2 className="hr-section-title">Compare plans side by side</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table className="hr-comparison-table">
                    <thead>
                      <tr>
                        <th>Feature</th>
                        <th>Free</th>
                        <th className="hr-col-featured">Growth</th>
                        <th>Enterprise</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((feature) => (
                        <tr key={feature.name}>
                          <td>{feature.name}</td>
                          <td>{renderFeatureValue(feature.free)}</td>
                          <td className="hr-col-featured">{renderFeatureValue(feature.pro)}</td>
                          <td>{renderFeatureValue(feature.business)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="struct-gutter"></div>
          </div>

          {/* FAQ */}
          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">
              <div className="hr-faq-section">
                <div className="hr-section-label" style={{ textAlign: 'center' }}>FAQ</div>
                <h2 className="hr-section-title">Pricing questions, answered.</h2>
                {faqs.map((faq, i) => (
                  <div key={i} className="hr-faq-card">
                    <h3>{faq.question}</h3>
                    <p>{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="struct-gutter"></div>
          </div>

          {/* CTA */}
          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">
              <div className="hr-pricing-cta">
                <div className="hr-section-label">Get Started</div>
                <h2 className="hr-section-title">Start hiring with<br />the right plan.</h2>
                <p className="hr-section-desc" style={{ textAlign: 'center', margin: '0 auto 36px' }}>
                  Every plan includes AI sourcing, fit scoring, and a recruiter-grade pipeline. Pick the one that fits your team today.
                </p>
                <div className="hr-cta-btns">
                  <a
                    href="/recruiter-auth"
                    className="hr-btn-demo"
                    onClick={(e) => {
                      e.preventDefault();
                      setLocation('/recruiter-auth');
                    }}
                  >
                    Start Free
                  </a>
                  <a
                    href="/demo"
                    className="hr-btn-pricing"
                    onClick={(e) => {
                      e.preventDefault();
                      setLocation('/demo');
                    }}
                  >
                    Book a Demo
                  </a>
                </div>
              </div>
            </div>
            <div className="struct-gutter"></div>
          </div>

          <HomepageFooter />
        </div>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upgrade to Growth</DialogTitle>
            <DialogDescription>
              {checkoutMode === 'public'
                ? "Enter your details to get started."
                : checkoutMode === 'create-org'
                ? "Create your organization and start your subscription."
                : "Choose your seat count and billing cycle."}
            </DialogDescription>
          </DialogHeader>

          {requiresLogin ? (
            <div className="py-4">
              <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Account already exists
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    An account with this email already has an organization. Please log in to manage your subscription.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" onClick={() => { setRequiresLogin(false); setEmail(''); }} className="flex-1">
                  Use Different Email
                </Button>
                <Button onClick={() => setLocation('/recruiter-auth?redirect=/org/billing')} className="flex-1">
                  Log In
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-4">
                {/* Email field - only for public checkout */}
                {checkoutMode === 'public' && (
                  <div className="space-y-2">
                    <Label>Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      We'll send your receipt and login details here.
                    </p>
                  </div>
                )}

                {/* Org name - for public and create-org modes */}
                {(checkoutMode === 'public' || checkoutMode === 'create-org') && (
                  <div className="space-y-2">
                    <Label>Organization Name</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Acme Inc"
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                )}

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
                    Growth includes {formatMetric(proCredits)} AI credits per seat per month, pooled across the organization. With {seats} seat{seats === 1 ? "" : "s"}, that is {proCredits * seats} included credits per month. {commercialConfig?.seatPolicies?.seatAddCredits.summary} {creditPackConfig ? `Extra ${creditPackConfig.creditsPerPack}-credit packs are available at ${formatPriceINR(creditPackConfig.pricePerPack)}.` : 'Extra credit packs are available.'}
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

                {/* Optional GSTIN field */}
                {(checkoutMode === 'public' || checkoutMode === 'create-org') && (
                  <div className="space-y-2">
                    <Label>GSTIN (Optional)</Label>
                    <Input
                      placeholder="22AAAAA0000A1Z5"
                      value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional. Add GSTIN if you want it printed on the invoice.
                    </p>
                  </div>
                )}

                {proPlan && (
                  <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
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
                <Button onClick={handleCheckout} disabled={isCheckoutPending}>
                  {isCheckoutPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Continue to Payment
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
