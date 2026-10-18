import { z } from "zod";

/**
 * Where a public applicant came from, for the owner's own records only.
 * Minimal tracking data linked to an applicant, stored in the owner-only
 * application_source_records table (the runtime may insert, never read).
 * Captured once per job on first landing: the referring site's host name
 * (never the full URL or an IP address), the three standard UTM tags and the
 * first-landing time. No free-form text.
 */
export const APPLICATION_SOURCE_VERSION = 1 as const;

const host = z
  .string()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/)
  // A real site name ends in a letter label; this rejects IPv4 addresses such
  // as 203.0.113.42 (IPv6 hosts are bracketed and already fail the pattern).
  .refine((value) => /[a-z]/.test(value.slice(value.lastIndexOf(".") + 1)), "IP addresses are not recorded");
const tag = z.string().min(1).max(100).regex(/^[A-Za-z0-9 ._+\-]+$/);

export const applicationSourceSchema = z
  .object({
    version: z.literal(APPLICATION_SOURCE_VERSION),
    referrerHost: host.optional(),
    utmSource: tag.optional(),
    utmMedium: tag.optional(),
    utmCampaign: tag.optional(),
    landedAt: z.string().datetime({ offset: false }),
  })
  .strict();

export type ApplicationSource = z.infer<typeof applicationSourceSchema>;

function cleanTag(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, 100);
  return tag.safeParse(trimmed).success ? trimmed : undefined;
}

/**
 * Build the record from the landing page address and the browser's referrer.
 * The referrer is kept only when it is a different site; same-site navigation
 * is not a source. Returns a value that always passes applicationSourceSchema.
 */
export function captureApplicationSource(input: {
  pageUrl: string;
  referrer: string;
  now: Date;
}): ApplicationSource {
  const record: ApplicationSource = {
    version: APPLICATION_SOURCE_VERSION,
    landedAt: input.now.toISOString(),
  };
  let page: URL | null = null;
  try {
    page = new URL(input.pageUrl);
  } catch {
    page = null;
  }
  if (page) {
    const utmSource = cleanTag(page.searchParams.get("utm_source"));
    const utmMedium = cleanTag(page.searchParams.get("utm_medium"));
    const utmCampaign = cleanTag(page.searchParams.get("utm_campaign"));
    if (utmSource) record.utmSource = utmSource;
    if (utmMedium) record.utmMedium = utmMedium;
    if (utmCampaign) record.utmCampaign = utmCampaign;
  }
  if (input.referrer) {
    try {
      const ref = new URL(input.referrer);
      const refHost = ref.hostname.toLowerCase().replace(/\.$/, "");
      const pageHost = page?.hostname.toLowerCase() ?? "";
      if (
        (ref.protocol === "https:" || ref.protocol === "http:") &&
        refHost !== pageHost &&
        host.safeParse(refHost).success
      ) {
        record.referrerHost = refHost;
      }
    } catch {
      /* unparsable referrer: no source */
    }
  }
  return record;
}

/**
 * Server-side reader for the submitted field. Never throws: missing, malformed
 * or oversized input simply means "no source recorded" so an application is
 * never refused because of tracking data.
 */
export function readApplicationSource(raw: unknown): ApplicationSource | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = applicationSourceSchema.safeParse(value);
  if (!parsed.success) return null;
  const landed = Date.parse(parsed.data.landedAt);
  // Reject clock values far in the future or older than 90 days.
  if (!Number.isFinite(landed) || landed > Date.now() + 5 * 60_000 || landed < Date.now() - 90 * 86_400_000) {
    return null;
  }
  return parsed.data;
}
