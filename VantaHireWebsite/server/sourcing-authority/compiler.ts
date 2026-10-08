import { z } from 'zod';
import { briefPayloadSchema, sourceHash } from '../job-brief/contracts';
import { hashSchema, idSchema, SOURCING_COMPILER_VERSION, sourcingHash, sourcingGrantRequestSchema } from './contracts';

const term = z.string().trim().min(1).max(160);
export const sourcingDigestSchema = z.object({
  topSkills: z.array(term).max(15),
  seniorityLevel: z.enum(['entry', 'mid', 'senior', 'lead', 'executive']),
  domain: term,
  constraints: z.array(z.string().max(500)).max(10),
  keyResponsibilities: z.array(z.string().max(1000)).max(5),
  titleSearchTerms: z.array(z.string().trim().min(3).max(60)).min(1).max(6),
  adjacentBuckets: z.array(z.array(z.string().trim().min(3).max(60)).min(1).max(4)).max(3),
  adjacentLocations: z.array(z.object({ metro: term, country: term }).strict()).max(3),
  tokenCount: z.number().int().nonnegative().max(4096),
  version: z.literal(3),
}).strict();

export const sourcingBasisSchema = z.object({
  briefVersionId: idSchema,
  materialHash: hashSchema,
  sourceHash: hashSchema,
  sourceJD: z.string().min(1).max(20000),
  title: term,
  location: term,
  payload: briefPayloadSchema,
}).strict().refine(v => sourceHash(v.sourceJD) === v.sourceHash, 'Source bytes do not match approval');
export type SourcingBasis = z.infer<typeof sourcingBasisSchema>;

export function digestBasisHash(basis: SourcingBasis): string {
  return sourcingHash({ briefVersionId: basis.briefVersionId, materialHash: basis.materialHash,
    sourceHash: basis.sourceHash, title: basis.title, location: basis.location, payload: basis.payload });
}

export class QueryMappingError extends Error {
  readonly code = 'QUERY_MAPPING_UNSUPPORTED';
  constructor(readonly criterionIds: string[]) { super('QUERY_MAPPING_UNSUPPORTED'); }
}
const unique = (items: string[]) => [...new Map(items.map(v => [v.trim().toLowerCase(), v.trim()])).values()];

/** Pure compile: no environment, DB, model or provider access. The pinned
 * Crustdata builder filters location/title/seniority only. Other criteria stay
 * assessment-only; never pretend a skill/years condition was sent as a filter. */
export function compileSourcingQuery(rawBasis: unknown, rawDigest: unknown, preparedBasisHash: string) {
  const basis = sourcingBasisSchema.parse(rawBasis);
  const digest = sourcingDigestSchema.parse(rawDigest);
  if (preparedBasisHash !== digestBasisHash(basis)) throw new Error('SOURCING_QUERY_STALE');
  const unsupported: string[] = [];
  const map: Array<{ criterionId: string; use: 'retrieval' | 'assessment'; field: string | null }> = [];
  const selections = new Map<string, string[]>();
  const skills: string[] = [], preferredSkills: string[] = [];
  let minimumExperience: number | undefined;
  for (const criterion of basis.payload.criteria) {
    const retrieval = criterion.use !== 'assessment' && criterion.class !== 'disqualifier' && criterion.class !== 'evidence_required';
    const field = ({ title: 'experience.employment_details.current.title', location: 'basic_profile.location.full_location',
      seniority: 'experience.employment_details.current.seniority_level' } as Record<string, string>)[criterion.subject];
    if (retrieval && (!field || criterion.requirement.kind !== 'text')) unsupported.push(criterion.id);
    if (retrieval && field && criterion.requirement.kind === 'text') {
      selections.set(criterion.subject, [...(selections.get(criterion.subject) ?? []), criterion.requirement.value]);
      map.push({ criterionId: criterion.id, use: 'retrieval', field });
    } else map.push({ criterionId: criterion.id, use: 'assessment', field: null });
    if (criterion.subject === 'skill' && criterion.requirement.kind === 'text' && ['must_have','preferred'].includes(criterion.class)) {
      (criterion.class === 'preferred' ? preferredSkills : skills).push(criterion.requirement.value);
    }
    if (criterion.subject === 'experience_years' && ['minimum_years', 'experience_range'].includes(criterion.requirement.kind) && 'minimum' in criterion.requirement && criterion.class === 'must_have') {
      minimumExperience = Math.max(minimumExperience ?? 0, criterion.requirement.minimum);
    }
  }
  // Different locations/seniorities cannot be silently collapsed into the one
  // value supported by the shipped client. No model chooses between them.
  for (const subject of ['location', 'seniority']) {
    if (unique(selections.get(subject) ?? []).length > 1) unsupported.push(...basis.payload.criteria.filter(c => c.subject === subject && c.use !== 'assessment').map(c => c.id));
  }
  const seniority = selections.get('seniority')?.[0]?.trim().toLowerCase() ?? digest.seniorityLevel;
  if (!['entry', 'mid', 'senior', 'lead', 'executive'].includes(seniority)) {
    unsupported.push(...basis.payload.criteria.filter(c => c.subject === 'seniority').map(c => c.id));
  }
  if (unsupported.length) throw new QueryMappingError(unique(unsupported));
  // An explicit recruiter retrieval title takes precedence over the prepared
  // digest. Never silently replace an edited requirement with model aliases.
  const requestedTitles = selections.get('title') ?? [];
  const titleTerms = unique((requestedTitles.length ? requestedTitles : digest.titleSearchTerms).map(t => t.toLowerCase()));
  if (titleTerms.length>6 || titleTerms.some(t=>t.length<3 || t.length>60)) {
    throw new QueryMappingError(basis.payload.criteria.filter(c=>c.subject==='title' && c.use!=='assessment').map(c=>c.id));
  }
  const compiledDigest = {
    ...digest,
    topSkills: unique(skills),
    seniorityLevel: seniority,
    titleSearchTerms: titleTerms,
  };
  const jobContext = {
    title: basis.title,
    location: selections.get('location')?.[0] ?? basis.location,
    jdDigest: JSON.stringify(compiledDigest),
    skills: unique(skills),
    goodToHaveSkills: unique(preferredSkills),
    ...(minimumExperience === undefined ? {} : { experienceYears: minimumExperience }),
  };
  // Cache market counts by exact searchable inputs, not criterion IDs, reasons,
  // preferred skills or adjacent rungs. Assessment edits do not buy a new probe.
  const previewQueryHash = sourcingHash({ compilerVersion: SOURCING_COMPILER_VERSION,
    location: jobContext.location.split(',')[0]!.trim(), titleSearchTerms: titleTerms, seniorityLevel: seniority });
  const query = { compilerVersion: SOURCING_COMPILER_VERSION, digestVersion: 3 as const, jobContext, criterionMap: map, previewQueryHash };
  return { ...query, briefVersionId: basis.briefVersionId, materialHash: basis.materialHash,
    sourceHash: basis.sourceHash, digestBasisHash: preparedBasisHash, queryHash: sourcingHash(query) };
}
export type SourcingQueryArtifact = ReturnType<typeof compileSourcingQuery>;

export type ExactAcquisitionEvidence={providerTotal:number|null;rawReturnedCount:number};
/** Compare actual normalized provider inputs, not a caller-supplied hash.
 * Discover's roleFamily is derived metadata, not a retrieval input when the
 * required nonempty explicit title list is present. It stays fingerprint-bound
 * but can never select the client's legacy role/skill fallback here. */
export function validateProviderGrant(artifact:SourcingQueryArtifact,raw:unknown,exact:ExactAcquisitionEvidence|null) {
  const command=sourcingGrantRequestSchema.parse(raw),input=command.providerInput,r=input.requirements;
  const digest=sourcingDigestSchema.parse(JSON.parse(artifact.jobContext.jdDigest));
  const normalized=(terms:string[])=>[...new Set(terms.map(s=>s.trim().toLowerCase()).filter(Boolean))];
  const skills=normalized([...digest.topSkills,...artifact.jobContext.skills,...artifact.jobContext.goodToHaveSkills]);
  const expectedSkills=[...new Set(skills.map(s=>SKILL_ALIASES[s]??s))].slice(0,12);
  const exactTitles=normalized(digest.titleSearchTerms);
  const adjacentBuckets=digest.adjacentBuckets.map(bucket=>bucket.map(t=>t.trim().toLowerCase()).filter(t=>t.length>=3&&t.length<=60).slice(0,6));
  let titles=exactTitles,location=artifact.jobContext.location,seniority:string[]|undefined;
  if(command.artifactHash!==artifact.queryHash || r.title!==artifact.jobContext.title.trim() || r.seniorityLevel!==digest.seniorityLevel ||
    r.domain!==digest.domain || r.experienceYears!==(artifact.jobContext.experienceYears??null) ||
    sourcingHash(r.topSkills)!==sourcingHash(expectedSkills) || sourcingHash(r.adjacentBuckets)!==sourcingHash(adjacentBuckets) ||
    sourcingHash(r.adjacentLocations)!==sourcingHash(digest.adjacentLocations))throw Error('SOURCING_PROVIDER_INPUT_MISMATCH');
  if(command.slot==='exact') {
    if(command.rungId!=='exact'||input.limit!==300)throw Error('SOURCING_PROVIDER_INPUT_MISMATCH');
  }else{
    if(!exact || !Number.isSafeInteger(exact.rawReturnedCount) || exact.rawReturnedCount<0 || exact.rawReturnedCount>=300 ||
      exact.providerTotal===null || !Number.isSafeInteger(exact.providerTotal) || exact.providerTotal<0 || exact.providerTotal>=300 ||
      input.limit!==300-exact.rawReturnedCount)throw Error('SOURCING_SPILL_REFUSED');
    if(/^adjacent_title:[0-2]$/.test(command.rungId)) {
      const bucket=adjacentBuckets[Number(command.rungId.split(':')[1])];
      titles=normalized(bucket??[]).filter(t=>!exactTitles.includes(t));
      if(!titles.length)throw Error('SOURCING_SPILL_REFUSED');
    }else if(command.rungId==='seniority:+-1'){
      const order=['entry','mid','senior','lead','executive'],position=order.indexOf(digest.seniorityLevel);
      seniority=order.slice(Math.max(0,position-1),position+2);
    }else if(/^adjacent_geo:[0-2]$/.test(command.rungId)){
      const next=digest.adjacentLocations[Number(command.rungId.split(':')[1])];
      const originalCountry=deriveCountryCodeFromLocationText(location);
      if(!next || !originalCountry || deriveCountryCodeFromLocationText(next.country)!==originalCountry)throw Error('SOURCING_SPILL_REFUSED');
      location=`${next.metro}, ${next.country}`;
    }else throw Error('SOURCING_SPILL_REFUSED');
  }
  if(r.location!==location || sourcingHash(r.titleSearchTerms)!==sourcingHash(titles) ||
    sourcingHash(r.querySeniorityLevels??null)!==sourcingHash(seniority??null))throw Error('SOURCING_PROVIDER_INPUT_MISMATCH');
  const exclusions=[...new Set(input.excludePersonIds)].sort((a,b)=>a-b);
  if(sourcingHash(exclusions)!==sourcingHash(input.excludePersonIds))throw Error('SOURCING_PROVIDER_INPUT_MISMATCH');
  return {command,providerInputHash:sourcingHash(input)};
}

// Exact pinned aliases used by Discover buildJobRequirements; only preparation
// normalization, never new ranking or inferred evidence.
const SKILL_ALIASES: Record<string, string> = {
  // Tech
  'nodejs': 'node.js',
  'node': 'node.js',
  'reactjs': 'react',
  'react.js': 'react',
  'vuejs': 'vue',
  'vue.js': 'vue',
  'angularjs': 'angular',
  'angular.js': 'angular',
  'golang': 'go',
  'nextjs': 'next.js',
  'next js': 'next.js',
  'nuxtjs': 'nuxt',
  'nuxt.js': 'nuxt',
  'expressjs': 'express',
  'express.js': 'express',
  'fastapi': 'fastapi',
  'fast api': 'fastapi',
  'postgres': 'postgresql',
  'pg': 'postgresql',
  'postgressql': 'postgresql',
  'mongo': 'mongodb',
  'k8s': 'kubernetes',
  'ts': 'typescript',
  'js': 'javascript',
  'cpp': 'c++',
  'dotnet': '.net',
  'dot net': '.net',
  'csharp': 'c#',
  'c sharp': 'c#',
  'micro-service': 'microservices',
  'micro services': 'microservices',
  'event driven': 'event-driven architecture',
  'event-driven': 'event-driven architecture',
  'event streaming': 'event-driven architecture',
  'event driven architecture': 'event-driven architecture',
  'distributed system': 'distributed systems',
  'distributed architectures': 'distributed systems',
  'message queue': 'message queues',
  'msg queue': 'message queues',
  'pub/sub': 'message queues',
  'pubsub': 'message queues',
  // Sales / GTM
  'sfdc': 'salesforce',
  'salesforce crm': 'salesforce',
  'salesforce.com': 'salesforce',
  'enterprise selling': 'enterprise sales',
  'b2b sales': 'enterprise sales',
  'outbound sales': 'outbound',
  'outbound prospecting': 'outbound',
  'cold outreach': 'outbound',
  'pipeline mgmt': 'pipeline management',
  'deal management': 'pipeline management',
  'forecast management': 'pipeline management',
  'forecasting': 'pipeline management',
  'solution selling': 'consultative selling',
  'challenger sale': 'consultative selling',
  'meddic': 'consultative selling',
  'value selling': 'consultative selling',
  // Customer success / TAM
  'csm': 'customer success',
  'customer success management': 'customer success',
  'client success': 'customer success',
  'account management': 'stakeholder management',
  'relationship management': 'stakeholder management',
  'client management': 'stakeholder management',
  'key account management': 'stakeholder management',
  'api integration': 'integrations',
  'api integrations': 'integrations',
  'system integration': 'integrations',
  'system integrations': 'integrations',
  'rest api': 'apis',
  'rest apis': 'apis',
  'api development': 'apis',
  'web apis': 'apis',
};

// Pinned Discover b17b65c country-only derivation. This private authority copy
// performs no geocoder/model call. Cross-repository parity is a test gate;
// future taxonomy drift must not silently authorize a different market.
const LOCATION_ALIAS_REWRITES: Array<[RegExp, string]> = [
  [/\bbengaluru\b/gi, 'bangalore'],
  [/\bbombay\b/gi, 'mumbai'],
  [/\bnyc\b/gi, 'new york'],
  [/\bsf\b/gi, 'san francisco'],
  [/\bgurugram\b/gi, 'gurgaon'],
  [/\bmünchen\b/gi, 'munich'],
  [/\bm nchen\b/gi, 'munich'],
];


const COUNTRY_TOKENS = new Set([
  'india',
  'usa',
  'us',
  'united',
  'states',
  'uk',
  'kingdom',
  'canada',
  'australia',
  'germany',
  'france',
]);

const COUNTRY_CODE_ALIASES: Record<string, string[]> = {
  AE: ['uae', 'united arab emirates', 'dubai', 'abu dhabi'],
  AU: ['australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide'],
  BR: ['brazil', 'sao paulo', 'rio de janeiro'],
  CA: ['canada', 'toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'edmonton', 'halifax', 'winnipeg'],
  DE: ['germany', 'deutschland', 'berlin', 'munich', 'frankfurt', 'hamburg'],
  ES: ['spain', 'madrid', 'barcelona'],
  FR: ['france', 'paris', 'lyon', 'marseille'],
  GB: ['uk', 'u k', 'united kingdom', 'england', 'scotland', 'wales', 'great britain', 'london', 'manchester', 'birmingham', 'edinburgh', 'glasgow', 'leeds', 'bristol'],
  ID: ['indonesia', 'jakarta'],
  IE: ['ireland', 'dublin'],
  IN: ['india', 'bangalore', 'bengaluru', 'mumbai', 'bombay', 'delhi', 'new delhi', 'hyderabad', 'chennai', 'pune', 'kolkata', 'noida', 'gurgaon', 'gurugram', 'ahmedabad', 'jaipur', 'lucknow', 'chandigarh', 'kochi', 'indore', 'coimbatore', 'thiruvananthapuram', 'nagpur', 'visakhapatnam'],
  IT: ['italy', 'rome', 'milan'],
  JP: ['japan', 'tokyo', 'osaka'],
  MX: ['mexico', 'mexico city', 'guadalajara', 'monterrey'],
  NL: ['netherlands', 'holland', 'amsterdam', 'rotterdam', 'the hague'],
  SG: ['singapore'],
  SE: ['sweden', 'stockholm', 'gothenburg', 'malmo'],
  US: ['us', 'u s', 'usa', 'u s a', 'united states', 'united states of america', 'america',
    'san francisco', 'new york', 'los angeles', 'seattle', 'austin', 'boston', 'chicago',
    'denver', 'atlanta', 'miami', 'portland', 'houston', 'dallas', 'phoenix', 'philadelphia',
    'san diego', 'san jose', 'washington dc', 'washington d c', 'raleigh', 'minneapolis', 'detroit',
    'salt lake city', 'charlotte', 'nashville', 'pittsburgh', 'columbus', 'indianapolis',
    'mountain view', 'palo alto', 'redmond', 'cupertino', 'menlo park',
    'san francisco bay area', 'bay area', 'silicon valley',
    'new york city', 'new york city metropolitan area', 'nyc metropolitan area',
    // US state names
    'california', 'texas', 'florida', 'washington', 'massachusetts',
    'illinois', 'georgia', 'colorado', 'virginia', 'oregon',
    'north carolina', 'new jersey', 'pennsylvania', 'ohio', 'michigan',
    'arizona', 'maryland', 'minnesota', 'tennessee', 'indiana', 'missouri', 'utah',
    'connecticut',
    // US state abbreviations (post-normalization form)
    'ca', 'tx', 'fl', 'wa', 'ma', 'il', 'ga', 'co', 'va', 'or',
    'nc', 'nj', 'pa', 'oh', 'mi', 'az', 'md', 'mn', 'tn', 'in', 'mo', 'ut', 'ct',
    'ny', 'dc'],
};


function canonicalizeLocation(text: string): string {
  let normalized = text.toLowerCase().trim();
  for (const [pattern, replacement] of LOCATION_ALIAS_REWRITES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/[^a-z0-9\s,]/g, ' ').replace(/\s+/g, ' ').trim();
}


function extractPrimaryCity(normalizedLocation: string): string | null {
  const [firstSegmentRaw] = normalizedLocation.split(',');
  let firstSegment = firstSegmentRaw?.trim() ?? '';
  if (!firstSegment) return null;
  firstSegment = firstSegment
    .replace(/^greater\s+/i, '')
    .replace(/\s+(bay\s+area|area|metropolitan\s+area|metropolitan\s+region|metropolitan|region|urban|district)$/i, '')
    .replace(/\s+city$/i, '')
    .trim();
  if (!firstSegment) return null;
  const tokens = firstSegment.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.every((token) => COUNTRY_TOKENS.has(token))) return null;
  // Strip trailing country words (e.g. "hyderabad india" → "hyderabad")
  if (tokens.length > 1 && COUNTRY_TOKENS.has(tokens[tokens.length - 1]!)) {
    const cityTokens = tokens.slice(0, -1);
    if (cityTokens.length > 0) return cityTokens.join(' ');
  }
  return firstSegment;
}


export function deriveCountryCodeFromLocationText(
  location: string | null | undefined,
): string | null {
  if (!location) return null;
  const normalized = canonicalizeLocation(location);
  if (!normalized) return null;

  const segments = normalized.split(',').map((segment) => segment.trim()).filter(Boolean);
  const wordTokens = segments.flatMap((seg) => seg.split(/\s+/).filter(Boolean));
  const derivedCity = extractPrimaryCity(normalized);

  const candidates = [
    // Last segment (e.g. "india" from "bangalore, india")
    segments[segments.length - 1],
    // Last two segments joined (e.g. "united states" from "new york, united states")
    segments.length > 1 ? segments.slice(-2).join(' ') : null,
    // Full normalized string
    normalized,
    // Each individual segment (e.g. "seattle" from "seattle, wa")
    ...segments,
    // Last word token (e.g. "india" from "hyderabad india")
    wordTokens[wordTokens.length - 1],
    // Last two word tokens joined (e.g. "united states")
    wordTokens.length > 1 ? wordTokens.slice(-2).join(' ') : null,
    // Derived city after stripping prefixes/suffixes (e.g. "bangalore" from "greater bangalore area")
    derivedCity,
  ].filter((value): value is string => Boolean(value));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    for (const [countryCode, aliases] of Object.entries(COUNTRY_CODE_ALIASES)) {
      if (aliases.includes(candidate)) return countryCode;
    }
  }

  return null;
}
