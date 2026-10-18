import {and,eq} from 'drizzle-orm';
import {db} from '../db';
import {jobSourcedCandidates,organizations} from '@shared/schema';
import {applicantContactBlocked} from '@shared/sourcing-candidate-origin';

export async function canContactSourcedCandidate(organizationId:number,jobId:number,candidateId:number):Promise<boolean> {
  const row=await db.query.jobSourcedCandidates.findFirst({where:and(
    eq(jobSourcedCandidates.id,candidateId),eq(jobSourcedCandidates.organizationId,organizationId),eq(jobSourcedCandidates.jobId,jobId)),
    columns:{candidateSummary:true,convertedApplicationId:true,appliedAt:true}});
  return !!row&&!applicantContactBlocked(row);
}

/** A worker resolves tenant/job from stored rows; caller IDs cannot bypass origin. */
export async function canResolveSourcedContact(tenantId:string,signalCandidateId:string,externalJobId:string):Promise<boolean> {
  if(!tenantId.trim()||!/^vanta:jobs:[1-9][0-9]*$/.test(externalJobId))return false;
  const jobId=Number(externalJobId.slice('vanta:jobs:'.length));
  if(!Number.isSafeInteger(jobId))return false;
  const org=await db.query.organizations.findFirst({where:eq(organizations.signalTenantId,tenantId),columns:{id:true}});
  if(!org)return false;
  const organizationId=org.id;
  const row=await db.query.jobSourcedCandidates.findFirst({where:and(
    eq(jobSourcedCandidates.signalCandidateId,signalCandidateId),eq(jobSourcedCandidates.organizationId,organizationId),eq(jobSourcedCandidates.jobId,jobId)),
    columns:{candidateSummary:true,convertedApplicationId:true,appliedAt:true}});
  return !!row&&!applicantContactBlocked(row);
}
