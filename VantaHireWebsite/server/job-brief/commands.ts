import { z } from 'zod';
import type { Pool } from 'pg';
import { resolveJobDescription } from '../../shared/jobDescription';
import { approveBriefSchema, currentBriefPayloadSchema, canonicalJson, currentJdSchema, saveBriefSchema, sourceHash, validateSourceSpans } from './contracts';
import { BriefError, BriefRepository, scopeParameters, type BriefScope } from './repository';

export type BriefRead = {
  revision:string;currentJD:string|null;sourceHash:string|null;
  latest:Record<string,unknown>|null;approvedVersionId:string|null;approvedMaterialHash:string|null;
  draft:Record<string,unknown>|null;
};
type PrivateRead=BriefRead & {originalJD:string|null;legacyDescription:string|null};

export async function readBrief(repository:BriefRepository,scope:BriefScope) {
  const raw=await repository.call<PrivateRead>('read',scopeParameters(scope));
  // The routine is private, but its legacy JSON must never be returned to the UI.
  const sources=([['original_prose',raw.originalJD],['description_prose',raw.legacyDescription]] as const)
    .flatMap(([kind,text])=>text!==null && currentJdSchema.safeParse(text).success ? [{kind,text}] : []);
  const initialized=raw.currentJD!==null;
  const distinct=new Set(sources.map(s=>s.text));
  return {
    revision:raw.revision,currentJD:raw.currentJD,sourceHash:raw.sourceHash,
    latest:raw.latest,approvedVersionId:raw.approvedVersionId,approvedMaterialHash:raw.approvedMaterialHash,draft:raw.draft,
    source:{classifierVersion:1,initialized,selectionRequired:!initialized,
      ambiguous:!initialized && distinct.size!==1,choices:initialized?[]:sources,
      legacyStructured:!!raw.legacyDescription && resolveJobDescription({description:raw.legacyDescription}).resolution==='unavailable'},
  };
}

export async function saveBrief(repository:BriefRepository,scope:BriefScope,input:unknown) {
  const parsed=saveBriefSchema.parse(input);
  validateSourceSpans(parsed.payload,parsed.currentJD);
  const {requestId,expectedRevision,...command}=parsed;
  return repository.call('save',[...scopeParameters(scope),requestId,expectedRevision,{action:'save_brief',...command}]);
}

export async function approveBrief(repository:BriefRepository,scope:BriefScope,input:unknown) {
  const command=approveBriefSchema.parse(input);
  return repository.call('approve',[...scopeParameters(scope),command.requestId,command.expectedRevision,command.versionId,sourceHash(canonicalJson(command))]);
}

const transitionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('moderate'),requestId:z.string().uuid(),status:z.enum(['approved','declined']),reviewComments:z.string().max(2000).optional()}).strict(),
  z.object({action:z.literal('publish'),requestId:z.string().uuid(),expectedRevision:z.number().int().nonnegative().safe().optional()}).strict(),
  z.object({action:z.literal('deactivate'),requestId:z.string().uuid(),expectedRevision:z.number().int().nonnegative().safe().optional(),reason:z.enum(['manual','filled','cancelled']).optional()}).strict(),
]);
/** actorRole comes from the authenticated session, never the body. SQL rechecks it. */
export async function transitionJob(repository:BriefRepository,scope:BriefScope,actorRole:string,input:unknown) {
  const parsed=transitionSchema.parse(input);
  const {requestId,...rest}=parsed;
  const expected='expectedRevision' in parsed?parsed.expectedRevision:undefined;
  const {expectedRevision:_ignored,...command}=rest as typeof rest & {expectedRevision?:number};
  if(actorRole!=='super_admin' && (parsed.action==='moderate' || expected===undefined)) throw new BriefError('BRIEF_REVISION_REQUIRED',400);
  return repository.call('save',[...scopeParameters(scope),requestId,actorRole==='super_admin'?null:expected,command]);
}

export const governedEditSchema=z.object({
  requestId:z.string().uuid(),expectedRevision:z.number().int().nonnegative().safe(),
  currentJD:currentJdSchema,sourceChoice:saveBriefSchema.shape.sourceChoice,
  requesterKind:saveBriefSchema.shape.requesterKind,reasonCode:saveBriefSchema.shape.reasonCode,
  note:z.string().max(300).optional(),
  patch:z.object({
    title:z.string().trim().min(1).max(300).optional(),location:z.string().trim().min(1).max(300).optional(),
    type:z.enum(['full-time','part-time','contract','internship','remote']).optional(),
    skills:z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    goodToHaveSkills:z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
    salaryMin:z.number().int().positive().nullable().optional(),salaryMax:z.number().int().positive().nullable().optional(),
    salaryPeriod:z.enum(['per_month','per_year']).nullable().optional(),
    educationRequirement:z.string().max(500).nullable().optional(),experienceYears:z.number().int().min(0).max(80).nullable().optional(),
    hiringManagerId:z.number().int().positive().nullable().optional(),clientId:z.number().int().positive().nullable().optional(),
  }).strict(),
}).strict();
export async function editGovernedJob(repository:BriefRepository,scope:BriefScope,input:unknown) {
  const {requestId,expectedRevision,...command}=governedEditSchema.parse(input);
  return repository.call('save',[...scopeParameters(scope),requestId,expectedRevision,{action:'edit_governed_job',...command}]);
}

/** Model output is a proposal. This validates it without saving or approving. */
export function parseDraftProposal(content:string,jd:string) {
  if (Buffer.byteLength(content,'utf8')>65_536) throw new BriefError('BRIEF_MODEL_INVALID',502);
  const proposal=currentBriefPayloadSchema.parse(JSON.parse(content));
  // AI may suggest alternatives, never silently promote the noisy title signal.
  for (const c of proposal.criteria) if (c.subject==='title') c.class='preferred';
  validateSourceSpans(proposal,jd);
  return proposal;
}

export function publicationCycle(job:{createdAt:Date|string;reactivatedAt:Date|string|null},now=new Date()):Date {
  const created=new Date(job.createdAt);const renewed=job.reactivatedAt?new Date(job.reactivatedAt):null;
  return renewed && Number.isFinite(renewed.getTime()) && renewed>=created && renewed<=now?renewed:created;
}

/** System-only caller: no HTTP actor override. Locks then reads fresh activity. */
export async function retireJobCycle(pool:Pool,jobId:number,mode:'expired'|'declined',now=new Date()):Promise<boolean> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='5s'");
    const result=await client.query('SELECT * FROM public.jobs WHERE id=$1 FOR UPDATE',[jobId]);
    const job=result.rows[0];
    if(!job) {await client.query('COMMIT');return false;}
    let eligible=false;
    if(mode==='declined') eligible=job.status==='declined' && job.deactivated_at===null && new Date(job.created_at).getTime()<now.getTime()-30*86400000;
    else if(job.is_active && job.status==='approved' && publicationCycle({createdAt:job.created_at,reactivatedAt:job.reactivated_at},now).getTime()<now.getTime()-60*86400000) {
      const activity=await client.query(`SELECT EXISTS(SELECT 1 FROM public.applications WHERE job_id=$1
        AND (applied_at>$2::timestamptz-interval '14 days' OR interview_date>$2::timestamptz)) active`,[jobId,now]);
      eligible=activity.rows[0]?.active===false;
    }
    if(!eligible) {await client.query('COMMIT');return false;}
    const reason=mode==='expired'?'auto_expired':'declined';
    await client.query(`UPDATE public.jobs SET is_active=false,deactivated_at=$2,deactivation_reason=$3,
      warning_email_sent=false,updated_at=$2 WHERE id=$1`,[jobId,now,reason]);
    await client.query(`INSERT INTO public.job_audit_log(organization_id,job_id,action,performed_by,actor_kind,reason,metadata)
      VALUES($1,$2,'deactivated',NULL,'system',$3,$4::jsonb)`,[job.organization_id,jobId,reason,{previousStatus:job.is_active?'active':'inactive',newStatus:'inactive'}]);
    await client.query('COMMIT');return true;
  } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally {client.release();}
}
