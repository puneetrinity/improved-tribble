import { useQuery } from "@tanstack/react-query";

// Types
export interface CreditBalance {
  allocated: number;
  used: number;
  remaining: number;
  rollover: number;
  purchasedCredits?: number;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface OrganizationAiActivity {
  windowDays: 30;
  totals: {
    operations: number;
    tokensIn: number;
    tokensOut: number;
  };
  byKind: Array<{
    kind: string;
    operations: number;
    tokensIn: number;
    tokensOut: number;
  }>;
}

// API functions
async function fetchCreditBalance() {
  const res = await fetch('/api/ai/credits', {
    credentials: 'include',
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to fetch credit balance');
  }
  return res.json();
}

async function fetchCreditUsage() {
  const res = await fetch('/api/ai/credits/usage', {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Failed to fetch credit usage');
  }
  return res.json();
}

// Hooks
export function useAiCredits() {
  return useQuery<CreditBalance | null>({
    queryKey: ['ai', 'credits'],
    queryFn: fetchCreditBalance,
    staleTime: 1000 * 30, // 30 seconds
  });
}

export function useAiCreditUsage(enabled: boolean) {
  return useQuery<OrganizationAiActivity>({
    queryKey: ['ai', 'credits', 'usage'],
    queryFn: fetchCreditUsage,
    enabled,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Check if user has enough credits for an action
 */
export function useHasCredits(requiredCredits: number = 1): boolean {
  const { data, isLoading } = useAiCredits();

  if (isLoading || !data) return true; // Assume has credits while loading

  return data.remaining >= requiredCredits;
}

/**
 * Get credit usage percentage
 */
export function useCreditUsagePercent(): number {
  const { data } = useAiCredits();

  if (!data || data.allocated === 0) return 0;

  return Math.min(100, Math.round((data.used / data.allocated) * 100));
}
