import {z} from 'zod';

// Where a previous applicant says they live, read from their résumé. Visible only to
// the organisation they applied to. Never inferred from the job, never a public fact.
const place=z.string().min(1).max(200).nullable();
export const resumeLocationSchema=z.object({version:z.literal(1),provenance:z.literal('resume'),
  city:place,country:place}).strict();
export type ResumeLocation={city:string|null;country:string|null};

/** Fails closed: anything malformed is treated as "location unknown". */
export function readResumeLocation(value:unknown):ResumeLocation|null {
  const parsed=resumeLocationSchema.safeParse(value);
  return parsed.success?{city:parsed.data.city,country:parsed.data.country}:null;
}

/** What sync stores: the full validated envelope (readers require it), or null when invalid or absent. */
export function resumeLocationForStorage(value:unknown):z.infer<typeof resumeLocationSchema>|null {
  const parsed=resumeLocationSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}

/** Display text, or null when unknown. A country alone is shown as the country. */
export function resumeLocationText(location:ResumeLocation|null|undefined):string|null {
  if(!location)return null;
  const parts=[location.city,location.country].filter((part):part is string=>!!part&&!!part.trim());
  return parts.length?parts.join(', '):null;
}
