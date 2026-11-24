import type { SparkStorageRead } from '../../shared/candidate-spark-v3';

export type JobsActor = {userId:number;authVersion:number};
export type JobsOwner = {subjectId:string;bindingId:string;pendingCommands:unknown[];hasMorePendingCommands:boolean};
export type JobsReadinessDependencies = {
 owner:(actor:JobsActor)=>Promise<JobsOwner>;
 read:(subjectId:string,bindingId:string)=>Promise<SparkStorageRead>;
};

/** Internal authority result only; never return a profile through MCP.
 * owner() performs the existing fresh account/privacy check both before and
 * after Memory. Recruiter-publication consent is deliberately not an input.
 */
export async function jobsReadiness(actor:JobsActor,deps:JobsReadinessDependencies){
 if(!Number.isSafeInteger(actor.userId)||actor.userId<1||!Number.isSafeInteger(actor.authVersion)||actor.authVersion<0)
  throw Error('authority_unavailable');
 const before=await deps.owner(actor);
 const profile=await deps.read(before.subjectId,before.bindingId);
 const after=await deps.owner(actor);
 if(before.subjectId!==after.subjectId||before.bindingId!==after.bindingId)throw Error('authority_unavailable');
 const confirmed=profile.confirmedProfile;
 const linkedin=confirmed?.linkedinUrl;
 const complete=profile.profileVersion>0&&profile.preferenceVersion>0&&profile.preferences!==null
  &&confirmed!==null&&!!confirmed.displayName&&confirmed.currentLocation!==null&&confirmed.skills.length>0
  &&typeof linkedin==='string'&&/^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%~-]+\/?$/.test(linkedin)
  &&profile.draft?.linkedinUrl===linkedin
  &&after.pendingCommands.length===0&&!after.hasMorePendingCommands;
 return {subject:after.subjectId,auth_generation:String(actor.authVersion),eligible:complete,
  reason:complete?'ready':'onboarding_required'};
}
