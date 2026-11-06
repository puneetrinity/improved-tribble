// P4: where the applicant lives and whether they'd relocate for THIS job, as they
// confirmed it on the application form. Never inferred from a résumé, the spark
// profile or the job, and never exported to Memory/Discover from here.
import { candidateLocationSchema, type CandidateLocation } from '@shared/application-location';

/** Off by default: the fields are optional (validated when sent) until the form ships them. */
export const applicationLocationRequired = () => process.env.APPLICATION_LOCATION_REQUIRED === 'true';

export type ApplicationLocationFacts = { candidateLocation: CandidateLocation; willingToRelocate: boolean };
export type ApplicationLocationField = 'location_city_required' | 'location_country_invalid' | 'relocation_required';
export type ApplicationLocationIntake =
  | { kind: 'ok'; facts: ApplicationLocationFacts | null }
  | { kind: 'invalid'; fields: ApplicationLocationField[] };

const FIELDS = ['locationCity', 'locationCountryCode', 'willingToRelocate'] as const;

/** Reads the three form fields. All three or none; partial or malformed input is refused.
 * `now` is the server's clock: the request can never set the confirmation time. */
export function readApplicationLocation(body: unknown, now: Date, required = applicationLocationRequired()): ApplicationLocationIntake {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const sent = FIELDS.filter(k => b[k] !== undefined && b[k] !== null && b[k] !== '');
  if (sent.length === 0 && !required) return { kind: 'ok', facts: null };

  const fields: ApplicationLocationField[] = [];
  const city = typeof b.locationCity === 'string' ? b.locationCity.normalize('NFC').trim() : null;
  const country = typeof b.locationCountryCode === 'string' ? b.locationCountryCode.trim() : null;
  const relocate = b.willingToRelocate === true || b.willingToRelocate === 'true' ? true
    : b.willingToRelocate === false || b.willingToRelocate === 'false' ? false : null;
  if (!city) fields.push('location_city_required');
  if (!country) fields.push('location_country_invalid');
  if (relocate === null) fields.push('relocation_required');
  if (fields.length) return { kind: 'invalid', fields };

  const parsed = candidateLocationSchema.safeParse({ version: 2, provenance: 'candidate_confirmed', city, countryCode: country, confirmedAt: now.toISOString() });
  if (!parsed.success) {
    const bad = new Set(parsed.error.issues.map(i => String(i.path[0] ?? '')));
    const out: ApplicationLocationField[] = [
      ...(bad.has('countryCode') ? ['location_country_invalid' as const] : []),
    ];
    // City problems, and anything else (for example the size limit), are reported on the city.
    if (bad.has('city') || out.length === 0) out.unshift('location_city_required');
    return { kind: 'invalid', fields: out };
  }
  return { kind: 'ok', facts: { candidateLocation: parsed.data, willingToRelocate: relocate! } };
}
