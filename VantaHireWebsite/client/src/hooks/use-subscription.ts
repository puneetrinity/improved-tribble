import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

// Types
export interface SubscriptionPlan {
  id: number;
  name: string;
  displayName: string;
  description?: string | null;
  pricePerSeatMonthly: number;
  pricePerSeatAnnual: number;
  aiCreditsPerSeatMonthly: number;
  maxCreditRolloverMonths: number;
  features: Record<string, any>;
  isActive: boolean;
  rateLimits?: {
    planName: string;
    dailyRateLimit: number;
    monthlyCredits: number;
    rolloverMonths: number;
    maxCredits: number;
  };
}

export interface Subscription {
  id: number;
  organizationId: number;
  planId: number;
  seats: number;
  billingCycle: 'monthly' | 'annual';
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  startDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt?: string | null;
  cancelAtPeriodEnd: boolean;
  gracePeriodEndDate?: string | null;
  paymentFailureCount: number;
  plan: SubscriptionPlan;
}

export interface SeatUsage {
  purchased: number;
  assigned: number;
  available: number;
}

export interface Invoice {
  id: number;
  invoiceNumber?: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  status: string;
  type: string;
  createdAt: string;
  completedAt?: string | null;
  invoiceUrl?: string | null;
}

export interface CreditPackConfig {
  creditsPerPack: number;
  pricePerPack: number;
  maxQuantity: number;
}

export interface BillingConfig {
  gstRate: number;
  taxEnabled: boolean;
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
  mode: 'prorated_immediate' | 'next_term_only';
  summary: string;
  detail: string;
}

export interface CommercialConfig {
  plans: SubscriptionPlan[];
  creditPack: CreditPackConfig;
  billing: BillingConfig;
  comparisonRows: CommercialComparisonRow[];
  faqs: CommercialFaqItem[];
  planCards: Record<string, CommercialPlanCard>;
  seatPolicies: {
    seatAddCredits: CommercialPolicy;
    seatReduceCredits: CommercialPolicy;
  };
}

export interface OrderStatus {
  orderId: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  cashfreeStatus?: string | null;
  paymentMethod?: string | null;
  type?: 'subscription' | 'seat_addition' | 'credit_pack' | 'refund';
  invoiceUrl?: string | null;
  failureReason?: string | null;
  totalAmount?: number;
}

// API functions
async function fetchCommercialConfig() {
  const res = await fetch('/api/subscription/commercial-config', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch commercial config');
  }
  return res.json();
}

async function fetchSubscription() {
  const res = await fetch('/api/subscription', {
    credentials: 'include',
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to fetch subscription');
  }
  return res.json();
}

async function fetchSeatUsage() {
  const res = await fetch('/api/subscription/seats/usage', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch seat usage');
  }
  return res.json();
}

async function fetchInvoices() {
  const res = await fetch('/api/subscription/invoices', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch invoices');
  }
  return res.json();
}

async function fetchOrderStatus(orderId: string) {
  const res = await fetch(`/api/subscription/order/${encodeURIComponent(orderId)}/status`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to fetch order status');
  }
  return res.json();
}

// Hooks
export function usePlans() {
  return useQuery<CommercialConfig, Error, SubscriptionPlan[]>({
    queryKey: ['subscription', 'commercial-config'],
    queryFn: fetchCommercialConfig,
    select: (config) => config.plans,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useCommercialConfig() {
  return useQuery<CommercialConfig>({
    queryKey: ['subscription', 'commercial-config'],
    queryFn: fetchCommercialConfig,
    staleTime: 1000 * 60 * 5,
  });
}

export function useSubscription() {
  return useQuery<Subscription | null>({
    queryKey: ['subscription', 'current'],
    queryFn: fetchSubscription,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useSeatUsage() {
  return useQuery<SeatUsage>({
    queryKey: ['subscription', 'seats'],
    queryFn: fetchSeatUsage,
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useInvoices() {
  return useQuery<Invoice[]>({
    queryKey: ['subscription', 'invoices'],
    queryFn: fetchInvoices,
    staleTime: 1000 * 60, // 1 minute
  });
}

export function useCreditPackConfig() {
  return useQuery<CommercialConfig, Error, CreditPackConfig>({
    queryKey: ['subscription', 'commercial-config'],
    queryFn: fetchCommercialConfig,
    select: (config) => config.creditPack,
    staleTime: 1000 * 60 * 5,
  });
}

export function useBillingConfig() {
  return useQuery<CommercialConfig, Error, BillingConfig>({
    queryKey: ['subscription', 'commercial-config'],
    queryFn: fetchCommercialConfig,
    select: (config) => config.billing,
    staleTime: 1000 * 60 * 5,
  });
}

export function useOrderStatus(orderId?: string | null) {
  return useQuery<OrderStatus>({
    queryKey: ['subscription', 'order-status', orderId],
    queryFn: () => fetchOrderStatus(orderId!),
    enabled: !!orderId,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || !status ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });
}

export function calculateTaxAmount(amount: number, gstRate: number): number {
  if (gstRate <= 0) return 0;
  return Math.round(amount * gstRate / 100);
}

export function calculateTotalWithTax(amount: number, gstRate: number): number {
  return amount + calculateTaxAmount(amount, gstRate);
}

export function useCreateCheckout() {
  return useMutation({
    mutationFn: async (data: { planId: number; seats: number; billingCycle: 'monthly' | 'annual' }) => {
      const res = await apiRequest('POST', '/api/subscription/checkout', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create checkout');
      }
      return res.json();
    },
  });
}

export function useCreateCreditPackCheckout() {
  return useMutation({
    mutationFn: async (data: { quantity: number }) => {
      const res = await apiRequest('POST', '/api/subscription/credit-packs/checkout', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create credit pack checkout');
      }
      return res.json();
    },
  });
}

export function useAddSeats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (additionalSeats: number) => {
      const res = await apiRequest('POST', '/api/subscription/seats', { additionalSeats });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add seats');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

export function useReduceSeats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { newSeatCount: number; memberIdsToKeep: number[] }) => {
      const res = await apiRequest('POST', '/api/subscription/seats/reduce', data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to reduce seats');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['organization', 'members'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/subscription/cancel');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to cancel subscription');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

export function useReactivateSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/subscription/reactivate');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to reactivate subscription');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

/**
 * Change billing cycle (takes effect at the next billing term)
 */
export function useChangeBillingCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (billingCycle: 'monthly' | 'annual') => {
      const res = await apiRequest('PATCH', '/api/subscription/billing-cycle', { billingCycle });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to change billing cycle');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

/**
 * Cancel pending billing cycle change
 */
export function useCancelBillingCycleChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest('DELETE', '/api/subscription/billing-cycle');
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to cancel billing cycle change');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}

/**
 * Download invoice PDF
 */
export function useDownloadInvoice() {
  return useMutation({
    mutationFn: async (transactionId: number) => {
      const res = await fetch(`/api/subscription/invoices/${transactionId}/pdf`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to download invoice');
      }
      // Handle the PDF download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const contentDisposition = res.headers.get('content-disposition');
      const fileName = contentDisposition
        ?.split('filename=')[1]
        ?.replace(/"/g, '') || `invoice-${transactionId}.pdf`;

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      return { success: true };
    },
  });
}

// Helper function to format price in INR
export function formatPriceINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}
