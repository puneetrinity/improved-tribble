import {z} from 'zod';
const id=z.number().int().positive().safe();
export const sourcingCandidateOriginSchema=z.discriminatedUnion('kind',[
  z.object({version:z.literal(1),kind:z.literal('public_profile')}).strict(),
  z.object({version:z.literal(1),kind:z.literal('organization_candidate'),
    applicationId:id,applicationJobId:id}).strict(),
]);
export type SourcingCandidateOrigin=z.infer<typeof sourcingCandidateOriginSchema>;
export function readSourcingCandidateOrigin(value:unknown):SourcingCandidateOrigin|{kind:'invalid'} {
  if(value===undefined)return {version:1,kind:'public_profile'};
  const parsed=sourcingCandidateOriginSchema.safeParse(value);
  return parsed.success?parsed.data:{kind:'invalid'};
}

/** Stored server rows only. Missing historical origin is not explicit null. */
export function applicantContactBlocked(row:{candidateSummary:unknown;convertedApplicationId?:unknown;appliedAt?:unknown}):boolean {
  if(row.convertedApplicationId!=null||row.appliedAt!=null)return true;
  const summary=row.candidateSummary;
  if(!summary||typeof summary!=='object'||Array.isArray(summary))return true;
  const origin=(summary as Record<string,unknown>).candidateOrigin;
  return readSourcingCandidateOrigin(origin).kind!=='public_profile';
}
