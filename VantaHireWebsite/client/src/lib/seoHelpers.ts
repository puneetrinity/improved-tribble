/**
 * Client-side SEO helper functions
 */

import { Job } from "@shared/schema";

export const DEFAULT_SITE_URL = "https://vantahire.com";

function getDisplayJobDescription(job: Pick<Job, "description" | "original_JD">): string {
  return job.original_JD ?? job.description;
}

/**
 * Strip HTML tags and normalize whitespace for meta descriptions.
 * Uses regex instead of DOM to work in both browser and SSR contexts.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove script/style tags while preserving HTML for JobPosting descriptions.
 */
export function sanitizeDescriptionHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .trim();
}

/**
 * Truncate text to specified length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generate meta description from job description
 */
export function generateJobMetaDescription(job: Job): string {
  const plainText = stripHtml(getDisplayJobDescription(job));
  const description = `Apply for ${job.title} at ${job.location}. ${plainText}`;
  return truncateText(description, 155); // SEO optimal length
}

// Extended job type for API response with client data
interface JobWithClientData extends Job {
  clientName?: string | null;
  clientDomain?: string | null;
  company?: string | null;
}

/**
 * Detect country from location string
 */
function detectCountry(location: string): string {
  const lower = location.toLowerCase();

  // India cities/regions
  if (/\b(india|bangalore|bengaluru|mumbai|delhi|chennai|hyderabad|pune|kolkata|gurgaon|gurugram|noida|ahmedabad)\b/.test(lower)) {
    return 'IN';
  }
  if (/\bsingapore\b/.test(lower)) return 'SG';
  if (/\b(malaysia|kuala lumpur|kl)\b/.test(lower)) return 'MY';
  if (/\b(philippines|manila|cebu)\b/.test(lower)) return 'PH';
  if (/\b(indonesia|jakarta)\b/.test(lower)) return 'ID';
  if (/\b(vietnam|ho chi minh|hanoi)\b/.test(lower)) return 'VN';
  if (/\b(thailand|bangkok)\b/.test(lower)) return 'TH';
  if (/\b(australia|sydney|melbourne|brisbane)\b/.test(lower)) return 'AU';
  if (/\b(usa|united states|new york|san francisco|california|texas|seattle)\b/.test(lower)) return 'US';
  if (/\b(uk|united kingdom|london|manchester)\b/.test(lower)) return 'GB';
  if (/\b(uae|dubai|abu dhabi)\b/.test(lower)) return 'AE';

  return 'IN'; // Default to India for APAC focus
}

function getCountryName(countryCode: string): string {
  const names: Record<string, string> = {
    IN: 'India',
    SG: 'Singapore',
    MY: 'Malaysia',
    PH: 'Philippines',
    ID: 'Indonesia',
    VN: 'Vietnam',
    TH: 'Thailand',
    AU: 'Australia',
    US: 'United States',
    GB: 'United Kingdom',
    AE: 'United Arab Emirates',
  };

  return names[countryCode] || countryCode;
}

/**
 * Parse job location for structured data
 */
function parseJobLocation(location: string | null) {
  if (!location) return null;

  const lower = location.toLowerCase();
  const remoteKeywords = ['remote', 'work from home', 'wfh', 'anywhere', 'virtual', 'distributed'];
  const isRemote = remoteKeywords.some(keyword => lower.includes(keyword));

  if (isRemote) {
    const countryCode = detectCountry(location);
    const countryName = getCountryName(countryCode);
    const isGlobalRemote = lower.includes('anywhere') || lower.includes('global') || lower.includes('worldwide');

    if (isGlobalRemote) {
      return { jobLocationType: 'TELECOMMUTE' };
    }

    // Region-specific remote
    return {
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: {
        '@type': 'Country',
        name: countryName,
      },
    };
  }

  const firstLocation = location.split('/')[0]?.split(',')[0]?.trim() || '';
  const countryCode = detectCountry(location);

  return {
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: firstLocation,
        addressCountry: countryCode,
      },
    },
  };
}

/**
 * Generate JobPosting JSON-LD structured data
 * Returns null if validation fails (mirrors server behavior)
 */
export function generateJobPostingJsonLd(job: JobWithClientData, baseUrl: string = DEFAULT_SITE_URL) {
  // Validate minimum requirements for Google Jobs
  if (!job.title || job.title.trim().length === 0) {
    console.warn('JobPosting validation failed: missing title', job.id);
    return null;
  }

  if (!job.location || job.location.trim().length === 0) {
    const isRemote = job.type?.toLowerCase() === 'remote';
    if (!isRemote) {
      console.warn('JobPosting validation failed: missing location', job.id);
      return null;
    }
  }

  if (!job.createdAt) {
    console.warn('JobPosting validation failed: missing createdAt', job.id);
    return null;
  }

  // Validate date is valid
  const datePosted = new Date(job.createdAt);
  if (isNaN(datePosted.getTime())) {
    console.warn('JobPosting validation failed: invalid createdAt date', job.id);
    return null;
  }

  // Sanitize description
  const displayDescription = getDisplayJobDescription(job);
  const plainDescription = stripHtml(displayDescription);
  const htmlDescription = sanitizeDescriptionHtml(displayDescription);

  // Map employment type
  const employmentTypeMap: Record<string, string> = {
    'full-time': 'FULL_TIME',
    'part-time': 'PART_TIME',
    'contract': 'CONTRACTOR',
    'temporary': 'TEMPORARY',
    'intern': 'INTERN',
  };
  const employmentType = job.type ? employmentTypeMap[job.type.toLowerCase()] : undefined;

  // Parse location
  const locationData = job.location
    ? parseJobLocation(job.location)
    : job.type?.toLowerCase() === 'remote'
      ? { jobLocationType: 'TELECOMMUTE' }
      : null;

  // Generate canonical URL (prefer slug for SEO-friendly URLs)
  const jobUrl = job.slug
    ? `${baseUrl}/jobs/${job.slug}`
    : `${baseUrl}/jobs/${job.id}`;

  // Determine hiring organization (prefer client if available, fallback to company)
  const orgName = job.clientName || job.company || 'VantaHire';
  const hiringOrganization: any = {
    '@type': 'Organization',
    name: orgName,
    logo: `${baseUrl}/logo.png`,
  };

  // Add client domain as sameAs if available
  if (job.clientDomain) {
    hiringOrganization.sameAs = job.clientDomain.startsWith('http')
      ? job.clientDomain
      : `https://${job.clientDomain}`;
  }

  const jobPosting: any = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: htmlDescription,
    datePosted: datePosted.toISOString(),
    hiringOrganization,
    identifier: {
      '@type': 'PropertyValue',
      name: orgName,
      value: job.id.toString(),
    },
    directApply: true,
    url: jobUrl,
  };

  // Add location data
  if (locationData?.jobLocation) {
    jobPosting.jobLocation = locationData.jobLocation;
  }
  if (locationData?.jobLocationType) {
    jobPosting.jobLocationType = locationData.jobLocationType;
  }
  if ((locationData as any)?.applicantLocationRequirements) {
    jobPosting.applicantLocationRequirements = (locationData as any).applicantLocationRequirements;
  }

  // Add optional fields
  if (employmentType) {
    jobPosting.employmentType = employmentType;
  }

  if (job.expiresAt || job.deadline) {
    const validThrough = job.expiresAt || job.deadline;
    if (validThrough) {
      jobPosting.validThrough = new Date(validThrough).toISOString();
    }
  }

  // Add skills if available
  if (job.skills && job.skills.length > 0) {
    jobPosting.skills = job.skills.join(', ');
  }

  return jobPosting;
}

/**
 * Generate canonical URL for job with slug support
 */
export function getJobCanonicalUrl(job: Job, baseUrl: string = DEFAULT_SITE_URL): string {
  return job.slug
    ? `${baseUrl}/jobs/${job.slug}`
    : `${baseUrl}/jobs/${job.id}`;
}
