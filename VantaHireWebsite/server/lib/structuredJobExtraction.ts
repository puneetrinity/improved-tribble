import { z } from 'zod';
import { getGroqClient, isGroqConfigured } from './groqClient';

const EXTRACTION_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const seniorityValues = ['intern', 'junior', 'mid', 'senior', 'lead', 'staff', 'principal', 'manager', 'director'] as const;
const roleFamilyValues = [
  'frontend',
  'backend',
  'fullstack',
  'devops',
  'platform_engineering',
  'data_engineering',
  'data_science',
  'mobile',
  'qa',
  'security',
  'product',
  'design',
  'other',
] as const;
const adjacentBucketValues = [
  'frontend',
  'backend',
  'fullstack',
  'platform_engineering',
  'data_engineering',
  'devops',
  'cloud_infrastructure',
  'mobile',
  'qa',
  'security',
  'distributed_systems',
  'microservices',
] as const;

const extractedJobSchema = z.object({
  roleTitle: z.string().min(1).max(200).default(''),
  roleFamily: z.enum(roleFamilyValues).default('other'),
  seniority: z.enum(seniorityValues).default('mid'),
  location: z.string().max(120).default(''),
  country: z.string().max(80).default(''),
  experienceYears: z.number().int().min(0).max(50).nullable().default(null),
  mustHaveSkills: z.array(z.string().min(1).max(80)).max(40).default([]),
  niceToHaveSkills: z.array(z.string().min(1).max(80)).max(60).default([]),
  skillAliases: z.record(z.string().min(1).max(40), z.string().min(1).max(80)).default({}),
  suppressedSkills: z.array(z.string().min(1).max(80)).max(30).default([]),
  allowedDomains: z.array(z.string().min(1).max(80)).max(20).default([]),
  excludedDomains: z.array(z.string().min(1).max(80)).max(20).default([]),
  adjacentBuckets: z.array(z.enum(adjacentBucketValues)).max(12).default([]),
  eliteSchools: z.array(z.string().min(1).max(80)).max(20).default([]),
  locationRequired: z.boolean().default(false),
  mustHaveGates: z.object({
    seniorityMin: z.enum(seniorityValues).nullable().default(null),
    experienceMinYears: z.number().int().min(0).max(50).nullable().default(null),
    minMustHaveSkillsMatched: z.number().int().min(0).max(20).nullable().default(null),
    locationRequired: z.boolean().default(false),
    rejectBuckets: z.array(z.string().min(1).max(80)).max(30).default([]),
    rejectTitleRegex: z.string().max(500).default(''),
  }).default({
    seniorityMin: null,
    experienceMinYears: null,
    minMustHaveSkillsMatched: null,
    locationRequired: false,
    rejectBuckets: [],
    rejectTitleRegex: '',
  }),
});

export type ExtractedStructuredJob = z.infer<typeof extractedJobSchema>;

interface JobExtractionHints {
  title?: string;
  location?: string;
  skills?: string[];
  goodToHaveSkills?: string[];
  experienceYears?: number | null;
  educationRequirement?: string;
}

const ADJACENT_SKILL_MAP: Record<string, string[]> = {
  javascript: ['typescript', 'react', 'angular', 'vue.js', 'node.js'],
  typescript: ['javascript', 'react', 'next.js', 'angular', 'node.js'],
  react: ['javascript', 'typescript', 'next.js', 'redux'],
  angular: ['javascript', 'typescript', 'rxjs'],
  vue: ['javascript', 'typescript', 'vue.js', 'nuxt.js'],
  'vue.js': ['javascript', 'typescript', 'nuxt.js'],
  'node.js': ['javascript', 'typescript', 'express.js', 'nestjs'],
  python: ['django', 'flask', 'fastapi', 'sqlalchemy'],
  java: ['spring', 'spring boot', 'microservices'],
  'c#': ['.net', 'asp.net', 'azure'],
  golang: ['go', 'microservices', 'distributed systems'],
  go: ['golang', 'microservices', 'distributed systems'],
  aws: ['terraform', 'docker', 'kubernetes', 'cloudformation'],
  azure: ['terraform', 'docker', 'kubernetes'],
  gcp: ['terraform', 'docker', 'kubernetes'],
  kubernetes: ['docker', 'helm', 'container orchestration'],
  docker: ['kubernetes', 'container orchestration'],
  terraform: ['infrastructure as code', 'iac'],
};

const ADJACENT_BUCKET_SKILL_MAP: Record<string, string[]> = {
  frontend: ['javascript', 'typescript', 'react', 'angular'],
  backend: ['rest api', 'sql', 'system design'],
  fullstack: ['javascript', 'typescript', 'node.js', 'react'],
  platform_engineering: ['terraform', 'kubernetes', 'observability'],
  data_engineering: ['sql', 'airflow', 'spark'],
  devops: ['ci/cd', 'terraform', 'docker', 'kubernetes'],
  cloud_infrastructure: ['aws', 'azure', 'gcp', 'terraform'],
  distributed_systems: ['microservices', 'kafka', 'grpc'],
  microservices: ['rest api', 'kafka', 'grpc'],
};

const SKILL_ALIAS_MAP: Record<string, string[]> = {
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  react: ['react.js', 'reactjs'],
  'next.js': ['nextjs'],
  angular: ['angularjs'],
  'vue.js': ['vue', 'vuejs'],
  'node.js': ['node', 'nodejs'],
  python: ['py'],
  kubernetes: ['k8s', 'kube'],
  terraform: ['tf', 'iac', 'infrastructure as code'],
  'amazon web services': ['aws'],
  aws: ['amazon web services'],
  'microsoft azure': ['azure'],
  azure: ['microsoft azure'],
  'google cloud platform': ['gcp'],
  gcp: ['google cloud platform'],
  docker: ['containerization'],
  'ci/cd': ['cicd', 'continuous integration', 'continuous delivery'],
  'rest api': ['restful api', 'rest'],
  postgresql: ['postgres', 'psql'],
  mysql: ['my sql'],
  mongodb: ['mongo'],
  elasticsearch: ['elastic search', 'es'],
  redis: ['redis cache'],
  grpc: ['g-rpc'],
  microservices: ['micro services'],
  'distributed systems': ['distributed system'],
  devops: ['dev ops'],
  'platform engineering': ['platform eng'],
  'cloud infrastructure': ['iaas', 'infra'],
};

function firstString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return first ?? '';
  }
  return '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return typeof value === 'string' && value.trim() ? [value] : [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = nullableNumber(item);
      if (parsed != null) {
        return parsed;
      }
    }
  }
  return null;
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['true', 'yes', 'required'].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) {
    return value.some((item) => booleanValue(item));
  }
  return false;
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = firstString(raw);
    if (!normalized) {
      continue;
    }
    result[key] = normalized;
  }
  return result;
}

function coerceEnumValue<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  const normalized = normalizeTerm(firstString(value)).replace(/-/g, '_');
  const match = allowed.find((item) => item === normalized);
  return match ?? fallback;
}

function maybeEnumValue<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  const normalized = normalizeTerm(firstString(value)).replace(/-/g, '_');
  const match = allowed.find((item) => item === normalized);
  return match ?? null;
}

function sanitizeModelExtraction(raw: unknown, fallback: ExtractedStructuredJob): ExtractedStructuredJob {
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawGates = input.mustHaveGates && typeof input.mustHaveGates === 'object'
    ? input.mustHaveGates as Record<string, unknown>
    : {};

  return {
    roleTitle: firstString(input.roleTitle) || fallback.roleTitle,
    roleFamily: coerceEnumValue(input.roleFamily, roleFamilyValues, fallback.roleFamily),
    seniority: coerceEnumValue(input.seniority, seniorityValues, fallback.seniority),
    location: firstString(input.location) || fallback.location,
    country: firstString(input.country) || fallback.country,
    experienceYears: nullableNumber(input.experienceYears) ?? fallback.experienceYears,
    mustHaveSkills: stringArray(input.mustHaveSkills),
    niceToHaveSkills: stringArray(input.niceToHaveSkills),
    skillAliases: asStringRecord(input.skillAliases),
    suppressedSkills: stringArray(input.suppressedSkills),
    allowedDomains: stringArray(input.allowedDomains),
    excludedDomains: stringArray(input.excludedDomains),
    adjacentBuckets: stringArray(input.adjacentBuckets)
      .map((item) => maybeEnumValue(item, adjacentBucketValues))
      .filter((item): item is typeof adjacentBucketValues[number] => item != null)
      .filter((item, index, arr) => arr.indexOf(item) === index),
    eliteSchools: stringArray(input.eliteSchools),
    locationRequired: booleanValue(input.locationRequired),
    mustHaveGates: {
      seniorityMin: rawGates.seniorityMin == null
        ? fallback.mustHaveGates.seniorityMin
        : coerceEnumValue(rawGates.seniorityMin, seniorityValues, fallback.mustHaveGates.seniorityMin ?? 'mid'),
      experienceMinYears: nullableNumber(rawGates.experienceMinYears) ?? fallback.mustHaveGates.experienceMinYears,
      minMustHaveSkillsMatched: nullableNumber(rawGates.minMustHaveSkillsMatched) ?? fallback.mustHaveGates.minMustHaveSkillsMatched,
      locationRequired: booleanValue(rawGates.locationRequired),
      rejectBuckets: stringArray(rawGates.rejectBuckets),
      rejectTitleRegex: firstString(rawGates.rejectTitleRegex),
    },
  };
}

function sanitizeJobDescription(description: string): string {
  return description
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/https?:\/\/[^\s]+/g, '[URL]')
    .replace(/system:|assistant:|user:/gi, '[REDACTED]')
    .trim();
}

function normalizeTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function uniqueTerms(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeTerm(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeAliasMap(input: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = normalizeTerm(rawKey);
    const value = normalizeTerm(rawValue);
    if (!key || !value) {
      continue;
    }
    result[key] = value;
  }

  return result;
}

function deriveAdjacentSkills(extracted: ExtractedStructuredJob): string[] {
  const directSkills = uniqueTerms([
    ...extracted.mustHaveSkills,
    ...extracted.niceToHaveSkills,
    ...Object.values(extracted.skillAliases),
  ]);

  const suppressed = new Set(uniqueTerms(extracted.suppressedSkills));
  const directSet = new Set(directSkills);
  const expanded: string[] = [];

  for (const skill of directSkills) {
    for (const candidate of ADJACENT_SKILL_MAP[skill] ?? []) {
      const normalized = normalizeTerm(candidate);
      if (!normalized || directSet.has(normalized) || suppressed.has(normalized)) {
        continue;
      }
      expanded.push(normalized);
    }
  }

  for (const bucket of extracted.adjacentBuckets) {
    for (const candidate of ADJACENT_BUCKET_SKILL_MAP[bucket] ?? []) {
      const normalized = normalizeTerm(candidate);
      if (!normalized || directSet.has(normalized) || suppressed.has(normalized)) {
        continue;
      }
      expanded.push(normalized);
    }
  }

  return uniqueTerms(expanded).slice(0, 12);
}

function deriveSkillAliases(extracted: ExtractedStructuredJob): Record<string, string> {
  const merged = normalizeAliasMap(extracted.skillAliases);
  const canonicalSkills = uniqueTerms([
    ...extracted.mustHaveSkills,
    ...extracted.niceToHaveSkills,
    ...Object.values(merged),
  ]);

  for (const canonical of canonicalSkills) {
    for (const alias of SKILL_ALIAS_MAP[canonical] ?? []) {
      const normalizedAlias = normalizeTerm(alias);
      if (!normalizedAlias || normalizedAlias === canonical) {
        continue;
      }
      if (!merged[normalizedAlias]) {
        merged[normalizedAlias] = canonical;
      }
    }
  }

  return merged;
}

function buildFallbackExtraction(rawDescription: string, hints: JobExtractionHints): ExtractedStructuredJob {
  const mustHaveSkills = uniqueTerms(hints.skills ?? []);
  const niceToHaveSkills = uniqueTerms(hints.goodToHaveSkills ?? []);
  const roleTitle = hints.title?.trim() || 'Unknown Role';
  const roleFamily = /devops|platform|sre/i.test(roleTitle)
    ? 'devops'
    : /frontend|ui|react|angular/i.test(roleTitle)
      ? 'frontend'
      : /backend|api|python|java|node/i.test(roleTitle)
        ? 'backend'
        : 'other';

  return {
    roleTitle,
    roleFamily,
    seniority: /senior|lead|staff|principal/i.test(roleTitle) ? 'senior' : 'mid',
    location: hints.location?.trim() || '',
    country: /india/i.test(rawDescription) || /bangalore|bengaluru|mumbai|pune|hyderabad|delhi/i.test(rawDescription) ? 'india' : '',
    experienceYears: hints.experienceYears ?? null,
    mustHaveSkills,
    niceToHaveSkills,
    skillAliases: {},
    suppressedSkills: [],
    allowedDomains: [],
    excludedDomains: [],
    adjacentBuckets: roleFamily === 'devops' ? ['platform_engineering', 'cloud_infrastructure'] : [],
    eliteSchools: [],
    locationRequired: false,
    mustHaveGates: {
      seniorityMin: /senior|lead|staff|principal/i.test(roleTitle) ? 'senior' : null,
      experienceMinYears: hints.experienceYears ?? null,
      minMustHaveSkillsMatched: mustHaveSkills.length > 0 ? Math.min(2, mustHaveSkills.length) : null,
      locationRequired: false,
      rejectBuckets: [],
      rejectTitleRegex: '',
    },
  };
}

export async function extractStructuredJobPosting(
  rawDescription: string,
  hints: JobExtractionHints = {},
): Promise<{ extracted: ExtractedStructuredJob; descriptionJson: string; signalExpandedSkills: string[] }> {
  const fallback = buildFallbackExtraction(rawDescription, hints);

  if (!isGroqConfigured()) {
    const signalExpandedSkills = deriveAdjacentSkills(fallback);
    const extracted = {
      ...fallback,
      niceToHaveSkills: uniqueTerms([...fallback.niceToHaveSkills, ...signalExpandedSkills]),
      skillAliases: deriveSkillAliases({
        ...fallback,
        niceToHaveSkills: uniqueTerms([...fallback.niceToHaveSkills, ...signalExpandedSkills]),
      }),
    };
    return {
      extracted,
      descriptionJson: JSON.stringify(extracted, null, 2),
      signalExpandedSkills,
    };
  }

  const prompt = [
    'Extract a structured hiring profile from the original job description.',
    'Return strict JSON only.',
    'Be evidence-based and conservative.',
    'Do not invent skills, domains, pedigree, or exclusions that are not supported by the JD.',
    'Use lowercase normalized values for skills, domains, aliases, and buckets.',
    'Use null or empty arrays when unclear.',
    'Adjacent buckets should be high-confidence related talent pools, not broad speculation.',
    'Suppressed skills should only include clearly irrelevant technologies explicitly contrasted or excluded.',
    'Reject regex and reject buckets should be narrow and only for obviously irrelevant backgrounds.',
    'If the recruiter provided hints, use them only as fallback when the JD clearly aligns.',
    'Schema:',
    JSON.stringify({
      roleTitle: 'string',
      roleFamily: roleFamilyValues,
      seniority: seniorityValues,
      location: 'string',
      country: 'string',
      experienceYears: 'number|null',
      mustHaveSkills: ['string'],
      niceToHaveSkills: ['string'],
      skillAliases: { js: 'javascript' },
      suppressedSkills: ['string'],
      allowedDomains: ['string'],
      excludedDomains: ['string'],
      adjacentBuckets: adjacentBucketValues,
      eliteSchools: ['string'],
      locationRequired: true,
      mustHaveGates: {
        seniorityMin: seniorityValues,
        experienceMinYears: 'number|null',
        minMustHaveSkillsMatched: 'number|null',
        locationRequired: true,
        rejectBuckets: ['string'],
        rejectTitleRegex: 'string',
      },
    }),
    `Recruiter hints: ${JSON.stringify(hints)}`,
    `Original JD:\n${sanitizeJobDescription(rawDescription).slice(0, 12000)}`,
  ].join('\n');

  try {
    const completion = await getGroqClient().chat.completions.create({
      model: EXTRACTION_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1400,
      messages: [
        {
          role: 'system',
          content: 'You are an expert recruiting intelligence extractor. Return strict JSON only, with conservative evidence-based extraction.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const coerced = sanitizeModelExtraction(JSON.parse(content), fallback);
    const parsed = extractedJobSchema.parse(coerced);
    const normalized: ExtractedStructuredJob = {
      ...parsed,
      roleTitle: parsed.roleTitle.trim() || fallback.roleTitle,
      roleFamily: parsed.roleFamily || fallback.roleFamily,
      seniority: parsed.seniority || fallback.seniority,
      location: parsed.location.trim() || fallback.location,
      country: normalizeTerm(parsed.country),
      mustHaveSkills: uniqueTerms(parsed.mustHaveSkills),
      niceToHaveSkills: uniqueTerms(parsed.niceToHaveSkills),
      skillAliases: normalizeAliasMap(parsed.skillAliases),
      suppressedSkills: uniqueTerms(parsed.suppressedSkills),
      allowedDomains: uniqueTerms(parsed.allowedDomains),
      excludedDomains: uniqueTerms(parsed.excludedDomains),
      eliteSchools: uniqueTerms(parsed.eliteSchools),
      mustHaveGates: {
        ...parsed.mustHaveGates,
        rejectBuckets: uniqueTerms(parsed.mustHaveGates.rejectBuckets),
        rejectTitleRegex: parsed.mustHaveGates.rejectTitleRegex.trim(),
      },
    };

    const signalExpandedSkills = deriveAdjacentSkills(normalized);
    const extracted: ExtractedStructuredJob = {
      ...normalized,
      niceToHaveSkills: uniqueTerms([...normalized.niceToHaveSkills, ...signalExpandedSkills]),
      skillAliases: deriveSkillAliases({
        ...normalized,
        niceToHaveSkills: uniqueTerms([...normalized.niceToHaveSkills, ...signalExpandedSkills]),
      }),
    };

    return {
      extracted,
      descriptionJson: JSON.stringify(extracted, null, 2),
      signalExpandedSkills,
    };
  } catch (error) {
    console.error('[JOB_EXTRACTION] Structured extraction failed, using fallback:', error);
    const signalExpandedSkills = deriveAdjacentSkills(fallback);
    const extracted = {
      ...fallback,
      niceToHaveSkills: uniqueTerms([...fallback.niceToHaveSkills, ...signalExpandedSkills]),
      skillAliases: deriveSkillAliases({
        ...fallback,
        niceToHaveSkills: uniqueTerms([...fallback.niceToHaveSkills, ...signalExpandedSkills]),
      }),
    };
    return {
      extracted,
      descriptionJson: JSON.stringify(extracted, null, 2),
      signalExpandedSkills,
    };
  }
}
