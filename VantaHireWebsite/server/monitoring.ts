import * as Sentry from "@sentry/node";
import type { Request, Response, NextFunction } from "express";

const REDACTED = "[redacted]";
const MAX_DEPTH = 4;
const SENSITIVE_KEY_PATTERN =
  /(email|phone|password|token|secret|cookie|authorization|resume|coverletter|extractedtext|rawbody|linkedin|username|firstname|lastname|name)/i;

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value == null) return value;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => scrubValue(item, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(input)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrubValue(nestedValue, depth + 1);
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

export function initServerMonitoring() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || Sentry.isInitialized()) return;
  const tracesSampleRate = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.01);

  Sentry.init({
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    tracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeEvent(event);
    },
  });
}

export function monitoringRequestContext(req: Request, _res: Response, next: NextFunction) {
  if (Sentry.isEnabled()) {
    Sentry.setTag("request_kind", req.path.startsWith("/api") ? "api" : "page");
    Sentry.setTag("request_path", req.route?.path || req.path);
    if (req.user?.id) {
      Sentry.setUser({
        id: String(req.user.id),
        segment: req.user.role,
      });
    }
  }

  next();
}

export function captureServerException(
  error: unknown,
  context?: {
    area?: string;
    action?: string;
    extra?: Record<string, unknown>;
  },
) {
  const normalizedError = error instanceof Error ? error : new Error(String(error));

  if (!Sentry.isEnabled()) {
    console.error("Monitoring capture skipped (disabled):", normalizedError, context);
    return;
  }

  Sentry.withScope((scope) => {
    if (context?.area) scope.setTag("area", context.area);
    if (context?.action) scope.setTag("action", context.action);
    if (context?.extra) scope.setExtras(scrubValue(context.extra) as Record<string, unknown>);
    Sentry.captureException(normalizedError);
  });
}
