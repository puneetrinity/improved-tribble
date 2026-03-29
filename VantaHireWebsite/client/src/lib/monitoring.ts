import * as Sentry from "@sentry/react";
import type { User as SelectUser } from "@shared/schema";
import { ApiError, RateLimitError } from "@/lib/queryClient";

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const MAX_STRING_LENGTH = 500;
const SENSITIVE_KEY_PATTERN =
  /(email|phone|password|token|secret|cookie|authorization|resume|coverletter|extractedtext|rawbody|linkedin|username|firstname|lastname|name)/i;

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";

  if (value == null) return value;

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => scrubValue(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value instanceof ApiError ? { status: value.status, code: value.code } : {}),
      ...(value instanceof RateLimitError ? { status: value.status } : {}),
    };
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(input)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = REDACTED;
      } else {
        output[key] = scrubValue(nestedValue, depth + 1);
      }
    }

    return output;
  }

  return String(value);
}

function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const sanitized: Sentry.ErrorEvent = { ...event };

  if (event.request) {
    const request: NonNullable<Sentry.ErrorEvent["request"]> = {
      ...event.request,
    };

    if (event.request.data) {
      request.data = scrubValue(event.request.data) as NonNullable<Sentry.ErrorEvent["request"]>["data"];
    }

    delete request.headers;
    delete request.cookies;
    sanitized.request = request;
  }

  if (event.extra) {
    sanitized.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    sanitized.contexts = scrubValue(event.contexts) as NonNullable<Sentry.ErrorEvent["contexts"]>;
  }

  if (event.user) {
    const user: NonNullable<Sentry.ErrorEvent["user"]> = {};
    if (event.user.id != null) {
      user.id = event.user.id;
    }
    if (event.user.segment != null) {
      user.segment = event.user.segment;
    }
    sanitized.user = user;
  }

  if (event.breadcrumbs) {
    sanitized.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const nextBreadcrumb = { ...breadcrumb };
      if (breadcrumb.data) {
        nextBreadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
      }
      return nextBreadcrumb;
    });
  }

  return sanitized;
}

function parseSampleRate(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function initClientMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || Sentry.isInitialized()) return;
  const tracesSampleRate = parseSampleRate(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0.01);

  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment: import.meta.env.MODE,
    tracesSampleRate,
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeEvent(event);
    },
  });
}

export function setMonitoringUser(user: Pick<SelectUser, "id" | "role"> | null | undefined) {
  if (!Sentry.isEnabled()) return;

  if (!user) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({
    id: String(user.id),
    segment: user.role,
  });
}

export function shouldCaptureClientError(error: unknown): boolean {
  if (error instanceof RateLimitError) return false;
  if (error instanceof ApiError) return error.status >= 500;
  if (error instanceof DOMException && error.name === "AbortError") return false;
  return error instanceof Error;
}

export function captureFrontendException(
  error: unknown,
  context?: {
    area?: string;
    action?: string;
    extra?: Record<string, unknown>;
  },
) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  if (!Sentry.isEnabled()) {
    if (import.meta.env.DEV) {
      console.error("Monitoring capture skipped (disabled):", normalizedError, context);
    }
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.area) scope.setTag("area", context.area);
    if (context?.action) scope.setTag("action", context.action);
    if (context?.extra) scope.setExtras(scrubValue(context.extra) as Record<string, unknown>);
    Sentry.captureException(normalizedError);
  });
}
