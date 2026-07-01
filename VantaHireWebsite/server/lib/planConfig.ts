import type { SubscriptionPlan } from "@shared/schema";

function getEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

export const PLAN_FREE = "free" as const;
export const PLAN_PRO = "pro" as const;
export const PLAN_BUSINESS = "business" as const;

export const PLAN_FREE_DISPLAY_NAME = "Free";
export const PLAN_PRO_DISPLAY_NAME = "Growth";
export const PLAN_BUSINESS_DISPLAY_NAME = "Enterprise";

export const FREE_PLAN_DESCRIPTION = "Basic ATS features for small teams";
export const PRO_PLAN_DESCRIPTION = "Scale your hiring output";
export const BUSINESS_PLAN_DESCRIPTION = "Custom fit for large teams";

export const FREE_PRICE_PER_SEAT_MONTHLY = getEnvInt("FREE_PRICE_PER_SEAT_MONTHLY", 0);
export const FREE_PRICE_PER_SEAT_ANNUAL = getEnvInt("FREE_PRICE_PER_SEAT_ANNUAL", 0);
export const PRO_PRICE_PER_SEAT_MONTHLY = getEnvInt("PRO_PRICE_PER_SEAT_MONTHLY", 899900);
export const PRO_PRICE_PER_SEAT_ANNUAL = getEnvInt("PRO_PRICE_PER_SEAT_ANNUAL", 8999000);
export const BUSINESS_PRICE_PER_SEAT_MONTHLY = getEnvInt("BUSINESS_PRICE_PER_SEAT_MONTHLY", 0);
export const BUSINESS_PRICE_PER_SEAT_ANNUAL = getEnvInt("BUSINESS_PRICE_PER_SEAT_ANNUAL", 0);

export const FREE_CREDITS_PER_MONTH = getEnvInt("FREE_AI_CREDITS_PER_MONTH", 300);
export const FREE_CREDITS_ROLLOVER_MONTHS = getEnvInt("FREE_AI_CREDITS_ROLLOVER_MONTHS", 3);
export const FREE_CREDITS_CAP = getEnvInt(
  "FREE_AI_CREDITS_CAP",
  FREE_CREDITS_PER_MONTH * FREE_CREDITS_ROLLOVER_MONTHS,
);
export const FREE_DAILY_RATE_LIMIT = getEnvInt("FREE_AI_DAILY_RATE_LIMIT", 20);

export const PRO_CREDITS_PER_SEAT_PER_MONTH = getEnvInt("PRO_AI_CREDITS_PER_MONTH", 600);
export const PRO_CREDITS_ROLLOVER_MONTHS = getEnvInt("PRO_AI_CREDITS_ROLLOVER_MONTHS", 3);
export const PRO_CREDITS_CAP = getEnvInt(
  "PRO_AI_CREDITS_CAP",
  PRO_CREDITS_PER_SEAT_PER_MONTH * PRO_CREDITS_ROLLOVER_MONTHS,
);
export const PRO_DAILY_RATE_LIMIT = getEnvInt("PRO_AI_DAILY_RATE_LIMIT", 100);

export const BUSINESS_CREDITS_PER_SEAT_PER_MONTH = getEnvInt("BUSINESS_AI_CREDITS_PER_MONTH", 1000);
export const BUSINESS_CREDITS_ROLLOVER_MONTHS = getEnvInt("BUSINESS_AI_CREDITS_ROLLOVER_MONTHS", 3);
export const BUSINESS_CREDITS_CAP = getEnvInt(
  "BUSINESS_AI_CREDITS_CAP",
  BUSINESS_CREDITS_PER_SEAT_PER_MONTH * BUSINESS_CREDITS_ROLLOVER_MONTHS,
);
export const BUSINESS_DAILY_RATE_LIMIT = getEnvInt(
  "BUSINESS_AI_DAILY_RATE_LIMIT",
  PRO_DAILY_RATE_LIMIT,
);

export const EXTRA_CREDIT_PACK_SIZE = getEnvInt("EXTRA_CREDIT_PACK_SIZE", 300);
export const EXTRA_CREDIT_PACK_PRICE = getEnvInt("EXTRA_CREDIT_PACK_PRICE", 99900);
export const MAX_CREDIT_PACK_QUANTITY = getEnvInt("MAX_CREDIT_PACK_QUANTITY", 10);

type PlanLike = Pick<
  SubscriptionPlan,
  | "name"
  | "aiCreditsPerSeatMonthly"
  | "maxCreditRolloverMonths"
  | "features"
  | "displayName"
  | "pricePerSeatMonthly"
  | "pricePerSeatAnnual"
  | "description"
>;

export interface PlanCreditSettings {
  creditsPerSeat: number;
  maxRolloverMonths: number;
  cap: number;
  dailyRateLimit: number;
}

interface PlanPriceSettings {
  pricePerSeatMonthly: number;
  pricePerSeatAnnual: number;
}

interface PlanPresentationSettings {
  displayName: string;
  description: string;
}

export interface PlanRateLimitInfo {
  planName: string;
  dailyRateLimit: number;
  monthlyCredits: number;
  rolloverMonths: number;
  maxCredits: number;
}

export interface CreditPackConfig {
  creditsPerPack: number;
  pricePerPack: number;
  maxQuantity: number;
}

export interface CommercialComparisonRow {
  name: string;
  free: boolean | string;
  pro: boolean | string;
  business: boolean | string;
}

export interface CommercialFaqItem {
  question: string;
  answer: string;
}

export interface CommercialPlanCard {
  summary: string;
  highlights: string[];
}

export interface CommercialPolicy {
  mode: "prorated_immediate" | "next_term_only";
  summary: string;
  detail: string;
}

export interface CommercialCatalog {
  plans: Array<SubscriptionPlan & { rateLimits: PlanRateLimitInfo }>;
  creditPack: CreditPackConfig;
  planCards: Record<string, CommercialPlanCard>;
  comparisonRows: CommercialComparisonRow[];
  faqs: CommercialFaqItem[];
  seatPolicies: {
    seatAddCredits: CommercialPolicy;
    seatReduceCredits: CommercialPolicy;
  };
}

function getNamedPlanCreditSettings(planName: string): PlanCreditSettings | null {
  if (planName === PLAN_FREE) {
    return {
      creditsPerSeat: FREE_CREDITS_PER_MONTH,
      maxRolloverMonths: FREE_CREDITS_ROLLOVER_MONTHS,
      cap: FREE_CREDITS_CAP,
      dailyRateLimit: FREE_DAILY_RATE_LIMIT,
    };
  }

  if (planName === PLAN_PRO) {
    return {
      creditsPerSeat: PRO_CREDITS_PER_SEAT_PER_MONTH,
      maxRolloverMonths: PRO_CREDITS_ROLLOVER_MONTHS,
      cap: PRO_CREDITS_CAP,
      dailyRateLimit: PRO_DAILY_RATE_LIMIT,
    };
  }

  if (planName === PLAN_BUSINESS) {
    return {
      creditsPerSeat: BUSINESS_CREDITS_PER_SEAT_PER_MONTH,
      maxRolloverMonths: BUSINESS_CREDITS_ROLLOVER_MONTHS,
      cap: BUSINESS_CREDITS_CAP,
      dailyRateLimit: BUSINESS_DAILY_RATE_LIMIT,
    };
  }

  return null;
}

function getNamedPlanPriceSettings(planName: string): PlanPriceSettings | null {
  if (planName === PLAN_FREE) {
    return {
      pricePerSeatMonthly: FREE_PRICE_PER_SEAT_MONTHLY,
      pricePerSeatAnnual: FREE_PRICE_PER_SEAT_ANNUAL,
    };
  }

  if (planName === PLAN_PRO) {
    return {
      pricePerSeatMonthly: PRO_PRICE_PER_SEAT_MONTHLY,
      pricePerSeatAnnual: PRO_PRICE_PER_SEAT_ANNUAL,
    };
  }

  if (planName === PLAN_BUSINESS) {
    return {
      pricePerSeatMonthly: BUSINESS_PRICE_PER_SEAT_MONTHLY,
      pricePerSeatAnnual: BUSINESS_PRICE_PER_SEAT_ANNUAL,
    };
  }

  return null;
}

function getPlanPresentationSettings(plan: Pick<SubscriptionPlan, "name" | "displayName" | "description">): PlanPresentationSettings {
  if (plan.name === PLAN_FREE) {
    return {
      displayName: PLAN_FREE_DISPLAY_NAME,
      description: FREE_PLAN_DESCRIPTION,
    };
  }

  if (plan.name === PLAN_PRO) {
    return {
      displayName: PLAN_PRO_DISPLAY_NAME,
      description: PRO_PLAN_DESCRIPTION,
    };
  }

  if (plan.name === PLAN_BUSINESS) {
    return {
      displayName: PLAN_BUSINESS_DISPLAY_NAME,
      description: BUSINESS_PLAN_DESCRIPTION,
    };
  }

  return {
    displayName: plan.displayName,
    description: plan.description ?? "",
  };
}

export function getPlanCreditSettings(
  plan: Pick<SubscriptionPlan, "name" | "aiCreditsPerSeatMonthly" | "maxCreditRolloverMonths">
): PlanCreditSettings {
  const namedSettings = getNamedPlanCreditSettings(plan.name);
  if (namedSettings) {
    return namedSettings;
  }

  const maxRolloverMonths = plan.maxCreditRolloverMonths || 3;
  const creditsPerSeat = plan.aiCreditsPerSeatMonthly;
  return {
    creditsPerSeat,
    maxRolloverMonths,
    cap: creditsPerSeat * maxRolloverMonths,
    dailyRateLimit: BUSINESS_DAILY_RATE_LIMIT,
  };
}

function normalizePlanFeatures(plan: PlanLike): SubscriptionPlan["features"] {
  const features = (plan.features || {}) as Record<string, unknown>;

  if (plan.name === PLAN_FREE) {
    return {
      ...features,
      basicAts: true,
      jobPosting: true,
      applicationManagement: true,
      aiMatching: true,
      aiContent: true,
    };
  }

  return features;
}

export function normalizePlan(plan: SubscriptionPlan): SubscriptionPlan {
  const settings = getPlanCreditSettings(plan);
  const priceSettings = getNamedPlanPriceSettings(plan.name);
  const presentationSettings = getPlanPresentationSettings(plan);

  return {
    ...plan,
    displayName: presentationSettings.displayName,
    description: presentationSettings.description,
    pricePerSeatMonthly: priceSettings?.pricePerSeatMonthly ?? plan.pricePerSeatMonthly,
    pricePerSeatAnnual: priceSettings?.pricePerSeatAnnual ?? plan.pricePerSeatAnnual,
    aiCreditsPerSeatMonthly: settings.creditsPerSeat,
    maxCreditRolloverMonths: settings.maxRolloverMonths,
    features: normalizePlanFeatures(plan),
  };
}

export function getCreditPackConfig(): CreditPackConfig {
  return {
    creditsPerPack: EXTRA_CREDIT_PACK_SIZE,
    pricePerPack: EXTRA_CREDIT_PACK_PRICE,
    maxQuantity: MAX_CREDIT_PACK_QUANTITY,
  };
}

export function getPlanRateLimitInfo(
  planOrName: string | Pick<SubscriptionPlan, "name" | "aiCreditsPerSeatMonthly" | "maxCreditRolloverMonths">
): PlanRateLimitInfo {
  if (typeof planOrName === "string") {
    const settings = getNamedPlanCreditSettings(planOrName);
    if (settings) {
      return {
        planName: planOrName,
        dailyRateLimit: settings.dailyRateLimit,
        monthlyCredits: settings.creditsPerSeat,
        rolloverMonths: settings.maxRolloverMonths,
        maxCredits: settings.cap,
      };
    }

    return {
      planName: planOrName,
      dailyRateLimit: BUSINESS_DAILY_RATE_LIMIT,
      monthlyCredits: 0,
      rolloverMonths: 3,
      maxCredits: 0,
    };
  }

  const settings = getPlanCreditSettings(planOrName);
  return {
    planName: planOrName.name,
    dailyRateLimit: settings.dailyRateLimit,
    monthlyCredits: settings.creditsPerSeat,
    rolloverMonths: settings.maxRolloverMonths,
    maxCredits: settings.cap,
  };
}

function getComparisonRows(): CommercialComparisonRow[] {
  return [
    { name: "Active jobs", free: "5", pro: "Unlimited", business: "Unlimited" },
    { name: "Included AI credits / month", free: String(FREE_CREDITS_PER_MONTH), pro: `${PRO_CREDITS_PER_SEAT_PER_MONTH} / seat`, business: "Custom" },
    { name: "Recruiter seats", free: "1", pro: "Unlimited", business: "Unlimited" },
    { name: "Talent Search (natural language)", free: true, pro: true, business: true },
    { name: "Fit scoring + skill breakdowns", free: true, pro: true, business: true },
    { name: "Identity confidence badges", free: true, pro: true, business: true },
    { name: "Kanban pipeline per job", free: true, pro: true, business: true },
    { name: "AI application screening", free: true, pro: true, business: true },
    { name: "Bulk pipeline actions", free: false, pro: true, business: true },
    { name: "Stage-based automation", free: false, pro: true, business: true },
    { name: "Stale candidate alerts", free: false, pro: true, business: true },
    { name: "Email outreach + templates", free: true, pro: true, business: true },
    { name: "WhatsApp outreach (Cloud API)", free: false, pro: true, business: true },
    { name: "Automated stage triggers", free: false, pro: true, business: true },
    { name: "Message audit trail", free: false, pro: true, business: true },
    { name: "Client Feedback Portal", free: false, pro: true, business: true },
    { name: "Shareable shortlist links", free: false, pro: true, business: true },
    { name: "Basic job analytics", free: true, pro: true, business: true },
    { name: "Pipeline velocity + conversion", free: false, pro: true, business: true },
    { name: "Source performance tracking", free: false, pro: true, business: true },
    { name: "Priority support", free: false, pro: true, business: true },
    { name: "SSO / SAML", free: false, pro: false, business: true },
    { name: "API access", free: false, pro: false, business: true },
    { name: "SLA guarantee", free: false, pro: false, business: true },
  ];
}

function getPlanCards(): Record<string, CommercialPlanCard> {
  return {
    [PLAN_FREE]: {
      summary: "Get started in minutes",
      highlights: [
        `Up to 5 active jobs`,
        `AI sourcing with fit scoring`,
        `Talent Search (natural language)`,
        `Kanban pipeline per job`,
        `Email outreach with templates`,
        `${FREE_CREDITS_PER_MONTH} AI credits per month`,
      ],
    },
    [PLAN_PRO]: {
      summary: "Scale your hiring output",
      highlights: [
        "Unlimited active jobs",
        `${PRO_CREDITS_PER_SEAT_PER_MONTH} AI credits per seat/month`,
        "Credits are pooled across your organization",
        `Extra ${EXTRA_CREDIT_PACK_SIZE}-credit top-ups available`,
        "Team collaboration",
        "Advanced analytics",
      ],
    },
    [PLAN_BUSINESS]: {
      summary: "Custom fit for large teams",
      highlights: [
        "Everything in Growth",
        "Dedicated account manager",
        "SSO / SAML authentication",
        "API access + custom integrations",
        "SLA guarantee",
        "Invoice billing (GST-compliant)",
      ],
    },
  };
}

function getFaqs(): CommercialFaqItem[] {
  return [
    {
      question: "Is there really a free plan?",
      answer: "Yes. No credit card required. No time limit. Start using VantaHire today and upgrade when you need more capacity.",
    },
    {
      question: "Can I switch plans anytime?",
      answer: "Yes. Upgrade or downgrade from billing at any time. Paid access is purchased for the selected monthly or annual term.",
    },
    {
      question: "How does seat-based pricing work?",
      answer: "You pay per recruiter who actively uses the platform. Team members who only view reports or dashboards do not count as seats.",
    },
    {
      question: "What happens if I add seats mid-cycle?",
      answer: `Seat additions are billed prorated for the remaining subscription term. Included AI credits are also granted prorated for the rest of the current monthly credit cycle after payment succeeds.`,
    },
    {
      question: "What happens if I reduce seats mid-cycle?",
      answer: "Seat access is reduced immediately, but included AI credits are not clawed back mid-cycle. The next monthly credit allocation uses the lower seat count.",
    },
    {
      question: "Do you offer annual discounts?",
      answer: "Yes. Annual billing saves compared to monthly. Toggle between monthly and annual above to see the difference.",
    },
    {
      question: "What payment methods do you accept?",
      answer: "Credit card and UPI for Growth via Cashfree. Enterprise customers can pay by invoice. GST-compliant invoicing is available for India.",
    },
    {
      question: "What happens when I hit my Free plan limits?",
      answer: "You will be notified before you reach your limit. No disruption to active jobs or candidates. Upgrade to Growth to remove limits.",
    },
    {
      question: "Is my data safe?",
      answer: "VantaHire enforces a three-tier privacy model. Your uploaded resumes and candidate data stay private to your organization. Only candidates who opt in are discoverable by other customers.",
    },
    {
      question: "Can I cancel anytime?",
      answer: "Yes. Cancel from your account settings. No cancellation fees. Your data remains accessible for 30 days after cancellation.",
    },
  ];
}

function getSeatPolicies() {
  return {
    seatAddCredits: {
      mode: "prorated_immediate" as const,
      summary: "Included credits are granted prorated immediately after seat-add payment succeeds.",
      detail: "Seat-add payments are prorated for the remaining subscription term. AI credits are prorated separately against the current monthly credit cycle and added to the shared org pool after payment succeeds.",
    },
    seatReduceCredits: {
      mode: "next_term_only" as const,
      summary: "Seat reductions do not claw back included credits mid-cycle.",
      detail: "Access changes immediately when seats are reduced, but included credits already granted remain available for the rest of the current monthly credit cycle. The next credit reset uses the lower seat count.",
    },
  };
}

export function getCommercialCatalog(plans: SubscriptionPlan[]): CommercialCatalog {
  const normalizedPlans = plans.map((plan) => normalizePlan(plan));

  return {
    plans: normalizedPlans.map((plan) => ({
      ...plan,
      rateLimits: getPlanRateLimitInfo(plan),
    })),
    creditPack: getCreditPackConfig(),
    planCards: getPlanCards(),
    comparisonRows: getComparisonRows(),
    faqs: getFaqs(),
    seatPolicies: getSeatPolicies(),
  };
}
