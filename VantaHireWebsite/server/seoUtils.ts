/**
 * Remove script/style tags from job descriptions while preserving HTML.
 */
export function sanitizeDescription(html: string): string {
  if (!html) return '';

  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .trim();
}

/**
 * Strip HTML tags for text-only meta descriptions.
 */
export function stripHtml(html: string): string {
  if (!html) return '';

  let plainText = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");

  return plainText.replace(/\s+/g, ' ').trim();
}

/**
 * Map job type to Google JobPosting employmentType enum
 */
export function mapEmploymentType(type: string | null): string | undefined {
  if (!type) return undefined;

  const mapping: Record<string, string> = {
    'full-time': 'FULL_TIME',
    'full time': 'FULL_TIME',
    'fulltime': 'FULL_TIME',
    'ft': 'FULL_TIME',
    'part-time': 'PART_TIME',
    'part time': 'PART_TIME',
    'parttime': 'PART_TIME',
    'pt': 'PART_TIME',
    'contract': 'CONTRACTOR',
    'contractor': 'CONTRACTOR',
    'freelance': 'CONTRACTOR',
    'temporary': 'TEMPORARY',
    'temp': 'TEMPORARY',
    'intern': 'INTERN',
    'internship': 'INTERN',
  };

  return mapping[type.toLowerCase()];
}

/**
 * Derive BLS SOC occupational category from job title (best-effort)
 */
function deriveOccupationalCategory(title: string): string | undefined {
  const lower = title.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/\b(software|engineer|developer|sde|swe|full.?stack|back.?end|front.?end|devops|sre|platform)\b/, '15-1252.00 - Software Developers'],
    [/\bdata scien/, '15-2051.00 - Data Scientists'],
    [/\bdata analy/, '15-2051.01 - Business Intelligence Analysts'],
    [/\bproduct manag/, '11-2021.00 - Marketing Managers'],
    [/\bproject manag/, '11-9199.00 - Managers, All Other'],
    [/\b(designer|ux|ui)\b/, '27-1024.00 - Graphic Designers'],
    [/\b(qa|quality|test|sdet)\b/, '15-1253.00 - Software Quality Assurance Analysts'],
    [/\b(security|infosec|cyber)\b/, '15-1212.00 - Information Security Analysts'],
    [/\b(recruiter|talent|hr|human resource)\b/, '13-1071.00 - Human Resources Specialists'],
    [/\b(sales|business develop|account exec)\b/, '41-3091.00 - Sales Representatives'],
    [/\bmarketing\b/, '13-1161.00 - Market Research Analysts'],
    [/\b(finance|accounti|cfo)\b/, '13-2011.00 - Accountants and Auditors'],
    [/\b(operations|ops manag)\b/, '11-1021.00 - General and Operations Managers'],
  ];
  for (const [re, code] of map) {
    if (re.test(lower)) return code;
  }
  return undefined;
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
  // Singapore
  if (/\bsingapore\b/.test(lower)) return 'SG';
  // Malaysia
  if (/\b(malaysia|kuala lumpur|kl)\b/.test(lower)) return 'MY';
  // Philippines
  if (/\b(philippines|manila|cebu)\b/.test(lower)) return 'PH';
  // Indonesia
  if (/\b(indonesia|jakarta)\b/.test(lower)) return 'ID';
  // Vietnam
  if (/\b(vietnam|ho chi minh|hanoi)\b/.test(lower)) return 'VN';
  // Thailand
  if (/\b(thailand|bangkok)\b/.test(lower)) return 'TH';
  // Australia
  if (/\b(australia|sydney|melbourne|brisbane)\b/.test(lower)) return 'AU';
  // USA
  if (/\b(usa|united states|new york|san francisco|california|texas|seattle)\b/.test(lower)) return 'US';
  // UK
  if (/\b(uk|united kingdom|london|manchester)\b/.test(lower)) return 'GB';
  // UAE
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
 * Map Indian cities to their state/UT for addressRegion.
 * Returns undefined for unrecognized cities or non-IN countries.
 */
function detectRegion(city: string, countryCode: string): string | undefined {
  if (countryCode !== 'IN') return undefined;

  const lower = city.toLowerCase().trim();
  const regionMap: Record<string, string> = {
    bangalore: 'Karnataka', bengaluru: 'Karnataka',
    mumbai: 'Maharashtra',
    pune: 'Maharashtra',
    delhi: 'Delhi', 'new delhi': 'Delhi',
    gurgaon: 'Haryana', gurugram: 'Haryana',
    noida: 'Uttar Pradesh', 'greater noida': 'Uttar Pradesh',
    chennai: 'Tamil Nadu',
    hyderabad: 'Telangana',
    kolkata: 'West Bengal',
    ahmedabad: 'Gujarat',
    jaipur: 'Rajasthan',
    lucknow: 'Uttar Pradesh',
    chandigarh: 'Chandigarh',
    kochi: 'Kerala', cochin: 'Kerala',
    trivandrum: 'Kerala', thiruvananthapuram: 'Kerala',
    indore: 'Madhya Pradesh',
    coimbatore: 'Tamil Nadu',
    vizag: 'Andhra Pradesh', visakhapatnam: 'Andhra Pradesh',
  };

  return regionMap[lower];
}

/**
 * Parse job location to determine if remote or physical location
 * Returns jobLocationType for remote, or jobLocation for physical
 * For remote jobs, also returns applicantLocationRequirements if region-specific
 */
export function parseJobLocation(location: string | null) {
  if (!location) return null;

  const lower = location.toLowerCase();

  // Check for remote indicators
  const remoteKeywords = ['remote', 'work from home', 'wfh', 'anywhere', 'virtual', 'distributed'];
  const isRemote = remoteKeywords.some(keyword => lower.includes(keyword));

  if (isRemote) {
    // Check if remote is region-specific (e.g., "Remote - India", "Remote (US only)")
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

  // Handle multiple locations (e.g., "Bangalore/Mumbai") - use first one
  const firstLocation = location.split('/')[0]?.split(',')[0]?.trim() || '';
  const countryCode = detectCountry(location);
  const region = detectRegion(firstLocation, countryCode);
  const countryName = getCountryName(countryCode);

  const address: any = {
    '@type': 'PostalAddress',
    addressLocality: firstLocation,
    addressCountry: countryCode,
  };
  if (region) {
    address.addressRegion = region;
  }

  return {
    jobLocation: {
      '@type': 'Place',
      address,
    },
    applicantLocationRequirements: {
      '@type': 'Country',
      name: countryName,
    },
  };
}

/**
 * Format date to ISO 8601 for structured data
 * Returns ISO string or undefined if invalid
 */
export function formatISODate(date: Date | string | null | undefined): string | undefined {
  if (!date) return undefined;

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return undefined;
    return dateObj.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Validate JobPosting required fields
 * Returns array of error messages
 */
export function validateJobPosting(job: {
  title?: string;
  description?: string;
  createdAt?: Date | string | null;
  location?: string;
  type?: string | null;
}): string[] {
  const errors: string[] = [];

  if (!job.title || job.title.trim().length === 0) {
    errors.push('Missing title');
  }

  if (!job.description || job.description.trim().length === 0) {
    errors.push('Missing description');
  }

  if (!job.createdAt) {
    errors.push('Missing datePosted (createdAt)');
  } else {
    const date = formatISODate(job.createdAt);
    if (!date) {
      errors.push('Invalid datePosted format');
    }
  }

  if (!job.location || job.location.trim().length === 0) {
    const isRemote = job.type?.toLowerCase() === 'remote';
    if (!isRemote) {
      errors.push('Missing location');
    }
  }

  return errors;
}

/**
 * Generate JobPosting structured data for Google Jobs
 */
export function generateJobPostingSchema(job: {
  id: number;
  title: string;
  description: string;
  location: string;
  type: string | null;
  skills?: string[] | null;
  company?: string | null;
  clientName?: string | null;
  clientDomain?: string | null;
  createdAt: Date | string;
  deadline?: Date | string | null;
  expiresAt?: Date | string | null;
  slug?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod?: string | null;
  experienceYears?: number | null;
  educationRequirement?: string | null;
}, baseUrl: string = 'https://ealana.com') {
  // Validate required fields
  const errors = validateJobPosting(job);
  if (errors.length > 0) {
    console.warn(`JobPosting validation errors for job ${job.id}:`, errors);
    return null;
  }

  // Preserve HTML in description for Google Jobs
  const htmlDescription = sanitizeDescription(job.description);

  // Map employment type
  const employmentType = mapEmploymentType(job.type);

  // Parse location
  const locationData = job.location
    ? parseJobLocation(job.location)
    : job.type?.toLowerCase() === 'remote'
      ? { jobLocationType: 'TELECOMMUTE' }
      : null;

  // Format dates
  const datePosted = formatISODate(job.createdAt);
  const validThrough = formatISODate(job.expiresAt || job.deadline);

  // Build canonical URL with slug if available (prefer pure slug for SEO)
  const jobUrl = job.slug
    ? `${baseUrl}/jobs/${job.slug}`
    : `${baseUrl}/jobs/${job.id}`;

  // Determine hiring organization (prefer client if available)
  const orgName = job.clientName || job.company || 'ealana';
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
    datePosted,
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

  if (validThrough) {
    jobPosting.validThrough = validThrough;
  }

  // Add skills if available
  if (job.skills && job.skills.length > 0) {
    jobPosting.skills = job.skills.join(', ');
  }

  // baseSalary (Gap 1) — hardcodes INR until a currency column is added
  if (job.salaryMin || job.salaryMax) {
    const unitText = job.salaryPeriod === 'per_month' ? 'MONTH' : 'YEAR';
    const quantValue: any = { '@type': 'QuantitativeValue', unitText };
    if (job.salaryMin && job.salaryMax) {
      quantValue.minValue = job.salaryMin;
      quantValue.maxValue = job.salaryMax;
    } else {
      quantValue.value = job.salaryMin || job.salaryMax;
    }
    jobPosting.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'INR',
      value: quantValue,
    };
  }

  // experienceRequirements (Gap 5)
  if (job.experienceYears && job.experienceYears > 0) {
    jobPosting.experienceRequirements = {
      '@type': 'OccupationalExperienceRequirements',
      monthsOfExperience: job.experienceYears * 12,
    };
  }

  // educationRequirements (Gap 5)
  if (job.educationRequirement) {
    jobPosting.educationRequirements = {
      '@type': 'EducationalOccupationalCredential',
      credentialCategory: job.educationRequirement,
    };
  }

  // occupationalCategory (Gap 6) — best-effort title match
  const occCategory = deriveOccupationalCategory(job.title);
  if (occCategory) {
    jobPosting.occupationalCategory = occCategory;
  }

  return jobPosting;
}

/**
 * Generate sitemap XML for jobs
 */
export function generateJobsSitemapXML(jobs: Array<{
  id: number;
  slug?: string | null;
  updatedAt?: Date | string;
  createdAt: Date | string;
}>, baseUrl: string = 'https://ealana.com'): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const urlEntries = jobs.map(job => {
    // Prefer pure slug for SEO-friendly URLs
    const slug = job.slug ? encodeURI(job.slug) : String(job.id);
    const url = `${normalizedBase}/jobs/${slug}`;

    const lastmod = formatISODate(job.updatedAt || job.createdAt);

    return `  <url>
    <loc>${url}</loc>
    ${lastmod ? `<lastmod>${lastmod.split('T')[0]}</lastmod>` : ''}
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}
