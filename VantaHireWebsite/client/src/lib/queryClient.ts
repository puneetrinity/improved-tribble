import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { fetchWithCsrf } from "./csrf";
import { captureFrontendException, shouldCaptureClientError } from "@/lib/monitoring";

// Rate limit info returned from 429 responses
export interface RateLimitInfo {
  error: string;
  limit?: number;
  remaining?: number;
  used?: number;
  retryAfterSeconds?: number;
}

// Custom error class for rate limit errors
export class RateLimitError extends Error {
  public readonly rateLimitInfo: RateLimitInfo;
  public readonly status = 429;

  constructor(info: RateLimitInfo) {
    super(info.error);
    this.name = 'RateLimitError';
    this.rateLimitInfo = info;
  }

  get retryAfterSeconds(): number | undefined {
    return this.rateLimitInfo.retryAfterSeconds;
  }

  get remaining(): number | undefined {
    return this.rateLimitInfo.remaining;
  }

  get limit(): number | undefined {
    return this.rateLimitInfo.limit;
  }

  get formattedRetryTime(): string {
    const seconds = this.rateLimitInfo.retryAfterSeconds;
    if (!seconds) return 'later';
    if (seconds < 60) return `in ${seconds} seconds`;
    if (seconds < 3600) return `in ${Math.ceil(seconds / 60)} minutes`;
    return `in ${Math.ceil(seconds / 3600)} hours`;
  }

  /** Get formatted remaining info for toast: "0/20 remaining" or empty if unavailable */
  get formattedRemaining(): string {
    if (this.rateLimitInfo.remaining !== undefined && this.rateLimitInfo.limit !== undefined) {
      return `${this.rateLimitInfo.remaining}/${this.rateLimitInfo.limit} remaining`;
    }
    return '';
  }
}

// Helper to check if error is a rate limit error
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export interface ApiErrorPayload {
  error?: string;
  message?: string;
  code?: string;
  errorCode?: string;
  action?: string;
  remainingCredits?: number;
  requiredCredits?: number;
  billingUrl?: string;
  pricingUrl?: string;
  planName?: string;
  planDisplayName?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;
  public readonly payload: ApiErrorPayload | undefined;

  constructor(status: number, message: string, payload?: ApiErrorPayload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof payload?.code === 'string'
      ? payload.code
      : typeof payload?.errorCode === 'string'
        ? payload.errorCode
        : undefined;
    this.payload = payload;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    // Handle rate limit responses specially
    if (res.status === 429) {
      try {
        const data = await res.json();
        throw new RateLimitError(data as RateLimitInfo);
      } catch (e) {
        if (e instanceof RateLimitError) throw e;
        // Fallback if JSON parsing fails
        throw new RateLimitError({ error: 'Rate limit exceeded. Please try again later.' });
      }
    }

    const text = (await res.text()) || res.statusText;
    let payload: ApiErrorPayload | undefined;
    try {
      payload = JSON.parse(text) as ApiErrorPayload;
    } catch {
      payload = undefined;
    }

    const message =
      (typeof payload?.message === 'string' && payload.message) ||
      (typeof payload?.error === 'string' && payload.error) ||
      text ||
      res.statusText;

    throw new ApiError(res.status, message, payload);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const headers: HeadersInit = data ? { "Content-Type": "application/json" } : {};

    const res = await fetchWithCsrf(url, {
      method,
      headers,
      ...(data !== undefined && { body: JSON.stringify(data) }),
    });

    await throwIfResNotOk(res);
    return res;
  } catch (error) {
    if (shouldCaptureClientError(error)) {
      captureFrontendException(error, {
        area: "api",
        action: "request",
        extra: { method, url },
      });
    }
    throw error;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const res = await fetchWithCsrf(
        queryKey[0] as string,
        {
          credentials: "include",
        },
        {
          retryOn403: true,
        },
      );

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      if (shouldCaptureClientError(error)) {
        captureFrontendException(error, {
          area: "api",
          action: "query",
          extra: { queryKey: queryKey[0] },
        });
      }
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
