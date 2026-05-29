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
import GridOverlay from "@/components/GridOverlay";
import { sectionLabel } from "@/lib/shared-styles";
import { apiRequest } from "@/lib/queryClient";

const planBtnBase = "block w-full py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium cursor-pointer text-center transition-all duration-200 no-underline disabled:opacity-50 disabled:cursor-not-allowed";
const planBtnPrimary = `${planBtnBase} bg-e-blue text-white border-none hover:brightness-110`;
const planBtnSecondary = `${planBtnBase} bg-transparent text-e-text border border-white/10 hover:border-white/25 hover:bg-white/[0.03]`;
const planFeatureLi = "flex items-start gap-2.5 text-[0.88rem] text-e-text2 leading-[1.5]";
const marketingCard = "rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.03)_100%)] shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl";

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
      return "-";
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
      const res = await apiRequest('POST', '/api/subscription/checkout-create-org', data);
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
    window.location.href = 'mailto:sales@ealana.com?subject=ealana%20Business%20Plan%20Inquiry';
  };

  const renderFeatureValue = (value: boolean | string) => {
    if (typeof value === 'boolean') {
      return value ? (
        <span className="inline-flex items-center justify-center w-5 h-5 text-hr-green"><Check size={16} /></span>
      ) : (
        <span className="inline-flex items-center justify-center w-5 h-5 text-[rgba(255,255,255,0.15)]"><X size={16} /></span>
      );
    }
    return <span style={{ color: '#E8E8ED' }}>{value}</span>;
  };

  return (
    <>
      <Helmet>
        <title>Pricing | ealana - Simple, Transparent Pricing</title>
        <meta name="description" content="Simple pricing. No surprises. Start free, upgrade when your team grows. No long contracts. AI sourcing, WhatsApp outreach, client portal, and pipeline management included." />
        <link rel="canonical" href="https://ealana.com/pricing" />
        <meta property="og:title" content="Pricing | ealana - Simple, Transparent Pricing" />
        <meta property="og:description" content="Simple pricing. No surprises. Start free, upgrade when your team grows." />
        <meta property="og:url" content="https://ealana.com/pricing" />
        <meta property="og:type" content="website" />
      </Helmet>

      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="relative pt-[140px] px-12 pb-20 text-center max-w-[1100px] mx-auto animate-hr-fade-up max-md:pt-[100px] max-md:px-5 max-md:pb-12">
            <div
              className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[760px] -translate-x-1/2"
              style={{
                background: "radial-gradient(ellipse, rgba(75,142,240,0.12) 0%, rgba(52,209,122,0.06) 42%, transparent 72%)",
                filter: "blur(80px)",
              }}
            />
            <div className={`${sectionLabel} relative text-e-blue`}>Pricing</div>
            <h1 className="relative font-display text-[clamp(2.8rem,5vw,4.5rem)] font-medium leading-[1.05] tracking-[-0.03em] mb-5 text-e-text">
              Simple pricing.
              <br />
              <span
                style={{
                  fontStyle: "italic",
                  background: "linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                No surprises.
              </span>
            </h1>
            <p className="relative text-base leading-[1.8] text-e-text2 max-w-[540px] mx-auto">
              Start free. Upgrade when your team grows. No long contracts. No hidden fees.
            </p>
          </div>

          {/* Pricing Cards */}
          <div
            className="grid grid-cols-3 gap-5 max-w-[1100px] mx-auto mb-[100px] px-12 max-lg:gap-4 max-lg:px-8 max-md:grid-cols-1 max-md:max-w-[420px] max-md:px-5 max-md:gap-6"
            style={{ animation: 'hr-fade-up 0.9s ease-out 0.15s both' }}
          >
            {/* Free Plan */}
            <div className={`${marketingCard} py-8 px-7 flex flex-col relative transition-all duration-300 hover:border-white/20 hover:-translate-y-1`}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4 shrink-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Users size={18} style={{ color: '#8891AA' }} />
              </div>
              <div className="font-display text-[1.35rem] font-medium text-e-text mb-1">Free</div>
              <div className="text-[0.85rem] text-e-text2 leading-[1.6] mb-6">{freePlanCard?.summary || "Get started in minutes"}</div>
              <div className="font-display text-[2.7rem] font-semibold text-e-text leading-none mb-1">
                {formatPriceINR(0)}
                <span className="text-[0.85rem] font-normal text-e-text2 font-ui"> /month</span>
              </div>
              <div className="text-[0.72rem] text-e-text3 mb-6 font-ui">&nbsp;</div>
              <div className="h-px bg-white/8 mb-5"></div>
              <ul className="list-none p-0 mb-7 flex flex-col gap-2.5 flex-1">
                {(freePlanCard?.highlights ?? []).map((highlight) => (
                  <li key={highlight} className={planFeatureLi}>
                    <Check size={16} className="w-4 h-4 shrink-0 mt-0.5 text-e-green" />
                    {highlight}
                  </li>
                ))}
              </ul>
              {currentPlan === 'free' && isLoggedIn ? (
                <button className={planBtnSecondary} disabled>Current Plan</button>
              ) : (
                <button className={planBtnSecondary} onClick={() => setLocation('/recruiter-auth')}>
                  Get Started -&gt;
                </button>
              )}
            </div>

            {/* Growth Plan */}
            <div className="rounded-[26px] py-8 px-7 flex flex-col relative transition-all duration-300 max-md:-order-1 hover:-translate-y-1"
              style={{
                background: "linear-gradient(180deg, rgba(75,142,240,0.18) 0%, rgba(17,19,38,0.96) 24%, rgba(13,15,30,0.98) 100%)",
                border: "1px solid rgba(75,142,240,0.4)",
                boxShadow: "0 24px 90px rgba(75,142,240,0.16), inset 0 1px 0 rgba(255,255,255,0.08)",
              }}>
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 font-mono text-[0.68rem] font-medium tracking-[0.08em] uppercase bg-e-blue text-white py-1 px-4 rounded-full whitespace-nowrap">Most Popular</div>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4 shrink-0" style={{ background: 'rgba(75,142,240,0.16)' }}>
                <Zap size={18} style={{ color: '#4B8EF0' }} />
              </div>
              <div className="font-display text-[1.35rem] font-medium text-e-text mb-1">Growth</div>
              <div className="text-[0.85rem] text-e-text2 leading-[1.6] mb-6">{proPlanCard?.summary || "Scale your hiring output"}</div>
              <div className="font-display text-[2.7rem] font-semibold text-e-text leading-none mb-1">
                {proPlan ? formatPriceINR(proPlan.pricePerSeatMonthly) : '...'}
                <span className="text-[0.85rem] font-normal text-e-text2 font-ui"> /seat/month</span>
              </div>
              <div className="text-[0.72rem] text-e-text3 mb-6 font-ui">
                {taxEnabled ? `+ GST (${gstRate}%) | Save with annual billing` : 'Save with annual billing'}
              </div>
              <div className="h-px bg-white/10 mb-5"></div>
              <div className="text-[0.72rem] text-e-text3 mb-3 font-mono tracking-[0.04em] uppercase">Everything in Free, plus:</div>
              <ul className="list-none p-0 mb-7 flex flex-col gap-2.5 flex-1">
                {(proPlanCard?.highlights ?? []).map((highlight) => (
                  <li key={highlight} className={planFeatureLi}>
                    <Check size={16} className="w-4 h-4 shrink-0 mt-0.5 text-e-green" />
                    {highlight.includes("top-ups") ? creditPackLabel : highlight}
                  </li>
                ))}
              </ul>
              {isPro ? (
                <button className={planBtnPrimary} disabled>Current Plan</button>
              ) : (
                <button className={`${planBtnPrimary} group`} onClick={handleSelectPro}>
                  Upgrade to Growth <span className="inline-block ml-1.5 transition-transform duration-200 group-hover:translate-x-[3px]">&rarr;</span>
                </button>
              )}
            </div>

            {/* Enterprise Plan */}
            <div className={`${marketingCard} py-8 px-7 flex flex-col relative transition-all duration-300 hover:border-white/20 hover:-translate-y-1`}>
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center mb-4 shrink-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <Building2 size={18} style={{ color: '#8891AA' }} />
              </div>
              <div className="font-display text-[1.35rem] font-medium text-e-text mb-1">Enterprise</div>
              <div className="text-[0.85rem] text-e-text2 leading-[1.6] mb-6">{businessPlanCard?.summary || "Custom fit for large teams"}</div>
              <div className="font-display text-[2.7rem] font-semibold text-e-text leading-none mb-1">Custom</div>
              <div className="text-[0.72rem] text-e-text3 mb-6 font-ui">Tailored to your needs</div>
              <div className="h-px bg-white/8 mb-5"></div>
              <div className="text-[0.72rem] text-e-text3 mb-3 font-mono tracking-[0.04em] uppercase">Everything in Growth, plus:</div>
              <ul className="list-none p-0 mb-7 flex flex-col gap-2.5 flex-1">
                {(businessPlanCard?.highlights ?? []).slice(1).map((highlight) => (
                  <li key={highlight} className={planFeatureLi}>
                    <Check size={16} className="w-4 h-4 shrink-0 mt-0.5 text-e-green" />
                    {highlight}
                  </li>
                ))}
              </ul>
              <button className={planBtnSecondary} onClick={handleContactSales}>
                Contact Sales
              </button>
            </div>
          </div>

          {/* Feature Comparison */}
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div>
              <div
                className="max-w-[1100px] mx-auto mb-[100px] px-12 max-md:px-5 max-md:overflow-x-auto"
                style={{ animation: 'hr-fade-up 0.9s ease-out 0.3s both' }}
              >
                <h2 className="font-display text-[clamp(2.2rem,4vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.025em] mb-10 text-e-text text-center">Compare plans side by side</h2>
                <div style={{ overflowX: 'auto' }}>
                  <table className="w-full border border-white/10 rounded-[24px] overflow-hidden border-separate max-md:min-w-[560px] bg-[rgba(255,255,255,0.03)] backdrop-blur-xl" style={{ borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th className="py-4 px-5 text-left font-mono text-[0.72rem] font-semibold tracking-[0.06em] uppercase text-e-text3 bg-white/[0.05] border-b border-white/8">Feature</th>
                        <th className="py-4 px-5 font-ui text-[0.82rem] font-semibold text-e-text text-center bg-white/[0.05] border-b border-white/8">Free</th>
                        <th className="py-4 px-5 font-ui text-[0.82rem] font-semibold text-e-blue text-center bg-[rgba(75,142,240,0.09)] border-b border-white/8">Growth</th>
                        <th className="py-4 px-5 font-ui text-[0.82rem] font-semibold text-e-text text-center bg-white/[0.05] border-b border-white/8">Enterprise</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparisonRows.map((feature, idx) => {
                        const isLast = idx === comparisonRows.length - 1;
                        const borderClass = isLast ? '' : 'border-b border-white/8';
                        return (
                          <tr key={feature.name} className="group">
                            <td className={`py-3 px-5 text-[0.85rem] text-e-text font-normal text-left bg-[rgba(255,255,255,0.02)] ${borderClass} group-hover:bg-white/[0.04]`}>{feature.name}</td>
                            <td className={`py-3 px-5 text-[0.85rem] text-e-text2 text-center bg-[rgba(255,255,255,0.02)] ${borderClass} group-hover:bg-white/[0.04]`}>{renderFeatureValue(feature.free)}</td>
                            <td className={`py-3 px-5 text-[0.85rem] text-e-text2 text-center bg-[rgba(75,142,240,0.04)] ${borderClass} group-hover:bg-[rgba(75,142,240,0.08)]`}>{renderFeatureValue(feature.pro)}</td>
                            <td className={`py-3 px-5 text-[0.85rem] text-e-text2 text-center bg-[rgba(255,255,255,0.02)] ${borderClass} group-hover:bg-white/[0.04]`}>{renderFeatureValue(feature.business)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div></div>
          </div>

          {/* FAQ */}
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div>
              <div
                className="max-w-[720px] mx-auto mb-[100px] px-12 max-md:px-5"
                style={{ animation: 'hr-fade-up 0.9s ease-out 0.4s both' }}
              >
                <div className={`${sectionLabel} text-center text-e-blue`}>FAQ</div>
                <h2 className="font-display text-[clamp(2.2rem,4vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.025em] mb-10 text-e-text text-center">Pricing questions, answered.</h2>
                {faqs.map((faq, i) => (
                  <div key={i} className={`${marketingCard} py-6 px-7 mb-3 transition-all duration-200 hover:border-white/20`}>
                    <h3 className="font-display text-base font-medium text-e-text mb-2">{faq.question}</h3>
                    <p className="text-[0.875rem] text-e-text2 leading-[1.8]">{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
            <div></div>
          </div>

          {/* CTA */}
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div>
              <div className="text-center py-20 px-12 pb-[100px] border-t border-white/8 max-md:py-[60px] max-md:px-5">
                <div className={`${sectionLabel} text-e-blue`}>Get Started</div>
                <h2 className="font-display text-[clamp(2.2rem,4vw,3.2rem)] font-medium leading-[1.1] tracking-[-0.025em] mb-4 text-e-text max-w-[480px] mx-auto">Start hiring with<br />the right plan.</h2>
                <p className="text-base leading-[1.8] text-e-text2 max-w-[520px] mx-auto text-center mb-9">
                  Every plan includes AI sourcing, fit scoring, and a recruiter-grade pipeline. Pick the one that fits your team today.
                </p>
                <div className="flex items-center justify-center gap-3 max-md:flex-col max-md:w-full">
                  <a
                    href="/recruiter-auth"
                    className="bg-e-blue text-white border-none py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-all duration-200 inline-block hover:brightness-110 hover:shadow-[0_8px_36px_rgba(75,142,240,0.35)] max-md:w-full max-md:text-center"
                    onClick={(e) => {
                      e.preventDefault();
                      setLocation('/recruiter-auth');
                    }}
                  >
                    Start Free
                  </a>
                  <a
                    href="https://cal.com/ealana/quick-connect"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-transparent text-e-text border border-white/12 py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-all duration-200 inline-block hover:border-white/25 hover:bg-white/[0.03] max-md:w-full max-md:text-center"
                  >
                    Book a Demo
                  </a>
                </div>
              </div>
            </div>
            <div></div>
          </div>

          <HomepageFooter />
        </div>
      </div>

      {/* Checkout Dialog */}
      <Dialog open={checkoutDialogOpen} onOpenChange={setCheckoutDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto rounded-[24px] p-5 font-ui text-e-text public-theme border border-white/10 bg-[linear-gradient(180deg,rgba(17,19,38,0.98)_0%,rgba(13,15,30,0.98)_100%)] shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="font-display text-base font-medium text-e-text mb-1">Upgrade to Growth</DialogTitle>
              <DialogDescription className="text-[0.82rem] text-e-text2 leading-[1.6]">
                {checkoutMode === 'public'
                  ? "Enter your details to get started."
                  : checkoutMode === 'create-org'
                  ? "Create your organization and start your subscription."
                  : "Choose your seat count and billing cycle."}
              </DialogDescription>
            </div>
          </div>

          {requiresLogin ? (
            <div className="pt-2">
              <div className="flex items-start gap-3 p-4 bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] rounded-none">
                <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-[0.82rem] font-medium text-amber-200">
                    Account already exists
                  </p>
                  <p className="text-[0.78rem] text-amber-300/80 mt-1 leading-[1.5]">
                    An account with this email already has an organization. Please log in to manage your subscription.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button className={`${planBtnSecondary} flex-1`} onClick={() => { setRequiresLogin(false); setEmail(''); }}>
                  Use Different Email
                </button>
                <button className={`${planBtnPrimary} flex-1`} onClick={() => setLocation('/recruiter-auth?redirect=/org/billing')}>
                  Log In
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 pt-2">
              {/* Email field - only for public checkout */}
              {checkoutMode === 'public' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] font-medium text-e-text2">Email Address *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-e-text3" />
                    <input
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-white/[0.04] border border-white/10 rounded-xl py-2.5 pl-10 pr-3 font-ui text-[0.88rem] text-e-text outline-none transition-all duration-200 w-full placeholder:text-e-text3 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]"
                    />
                  </div>
                  <p className="text-[0.72rem] text-e-text3 leading-[1.5]">
                    We'll send your receipt and login details here.
                  </p>
                </div>
              )}

              {/* Org name - for public and create-org modes */}
              {(checkoutMode === 'public' || checkoutMode === 'create-org') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] font-medium text-e-text2">Organization Name *</label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-e-text3" />
                    <input
                      placeholder="Acme Inc"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="bg-white/[0.04] border border-white/10 rounded-xl py-2.5 pl-10 pr-3 font-ui text-[0.88rem] text-e-text outline-none transition-all duration-200 w-full placeholder:text-e-text3 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.78rem] font-medium text-e-text2">Number of Seats *</label>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={seats}
                  onChange={(e) => setSeats(parseInt(e.target.value) || 1)}
                  className="bg-white/[0.04] border border-white/10 rounded-xl py-2.5 px-3 font-ui text-[0.88rem] text-e-text outline-none transition-all duration-200 w-full placeholder:text-e-text3 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]"
                />
                <p className="text-[0.72rem] text-e-text3 leading-[1.5]">
                  Growth includes {formatMetric(proCredits)} AI credits per seat per month, pooled across the organization. With {seats} seat{seats === 1 ? "" : "s"}, that is {proCredits * seats} included credits per month. {commercialConfig?.seatPolicies?.seatAddCredits.summary} {creditPackConfig ? `Extra ${creditPackConfig.creditsPerPack}-credit packs are available at ${formatPriceINR(creditPackConfig.pricePerPack)}.` : 'Extra credit packs are available.'}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[0.78rem] font-medium text-e-text2">Billing Cycle *</label>
                <Select value={billingCycle} onValueChange={(v: 'monthly' | 'annual') => setBillingCycle(v)}>
                  <SelectTrigger className="bg-white/[0.04] border-white/10 rounded-xl text-e-text font-ui text-[0.88rem] py-2.5 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)] focus:ring-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-e-bg2 border border-white/10 rounded-xl text-e-text font-ui">
                    <SelectItem value="monthly" className="text-e-text rounded-lg focus:bg-white/[0.06] focus:text-e-text">Monthly</SelectItem>
                    <SelectItem value="annual" className="text-e-text rounded-lg focus:bg-white/[0.06] focus:text-e-text">Annual (Save 17%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Optional GSTIN field */}
              {(checkoutMode === 'public' || checkoutMode === 'create-org') && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.78rem] font-medium text-e-text2">GSTIN (Optional)</label>
                  <input
                    placeholder="22AAAAA0000A1Z5"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    className="bg-white/[0.04] border border-white/10 rounded-xl py-2.5 px-3 font-ui text-[0.88rem] text-e-text outline-none transition-all duration-200 w-full placeholder:text-e-text3 focus:border-e-blue focus:shadow-[0_0_0_2px_rgba(75,142,240,0.22)]"
                  />
                  <p className="text-[0.72rem] text-e-text3 leading-[1.5]">
                    Add GSTIN if you want it printed on the invoice.
                  </p>
                </div>
              )}

              {proPlan && (
                <div className="p-4 bg-white/[0.04] border border-white/10 rounded-xl">
                  <div className="flex justify-between text-[0.88rem] text-e-text2">
                    <span>Subtotal</span>
                    <span className="text-e-text">{formatPriceINR(subtotal)}</span>
                  </div>
                  {taxEnabled && (
                    <div className="mt-2 flex justify-between text-[0.88rem] text-e-text2">
                      <span>GST ({gstRate}%)</span>
                      <span className="text-e-text">{formatPriceINR(gstAmount)}</span>
                    </div>
                  )}
                  <div className="h-px bg-white/8 my-2.5"></div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-[0.88rem] text-e-text2">Total</span>
                    <span className="font-display font-semibold text-e-text text-lg">
                      {formatPriceINR(totalWithTax)}
                      <span className="text-[0.8rem] font-normal text-e-text3 font-ui">
                        /{billingCycle === 'monthly' ? 'month' : 'year'}
                      </span>
                    </span>
                  </div>
                  <p className="text-[0.72rem] text-e-text3 mt-1.5">
                    {taxEnabled
                      ? `GST (${gstRate}%) is added at checkout.`
                      : 'No additional tax is configured.'}
                  </p>
                </div>
              )}

              <div className="flex gap-2 mt-1">
                <button className={`${planBtnPrimary} flex-1 flex items-center justify-center gap-2`} onClick={handleCheckout} disabled={isCheckoutPending}>
                  {isCheckoutPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Continue to Payment
                </button>
                <button className={`${planBtnSecondary} flex-1`} onClick={() => setCheckoutDialogOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
