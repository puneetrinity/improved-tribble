import { createHash } from 'node:crypto';
import { z } from 'zod';
import { currentBriefPayloadSchema, type BriefPayload } from '../job-brief/contracts';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const rankedCandidateSchema=z.object({
  protocolVersion:z.literal(2),revisionId:z.string().uuid(),contractHash:hash,outputHash:hash,asOf:z.string().datetime(),
  candidateId:z.string().min(1).max(200),ordinal:z.number().int().min(1).max(100),
  N:z.number().int().min(0).max(36),D:z.number().int().min(0).max(36),L:z.number().int().min(0).max(36_000_000),
  eligibility:z.enum(['in_range','wider','unconstrained']),
  experience:z.object({version:z.literal('recorded-experience-v1'),asOf:z.string().datetime(),
    status:z.enum(['measured','bounded','incomplete','unavailable','uncertain_boundary']),
    lowerDays:z.number().int().nonnegative().nullable(),upperDays:z.number().int().nonnegative().nullable(),
    display:z.string().max(200),reason:z.string().max(100)}).strict(),
  assessments:z.array(z.object({criterionIds:z.array(z.string().uuid()).min(1).max(12),labels:z.array(z.string().min(1).max(120)).min(1).max(12),subject:z.string().max(40),
    state:z.enum(['met','not_met','unknown']),mapped:z.boolean(),weight:z.union([z.literal(0),z.literal(1),z.literal(3)]),
    points:z.number().int().min(0).max(3),localPoints:z.number().int().min(0).max(3_000_000),
    refs:z.array(z.string().max(160)).max(1000)}).strict()).max(12),
}).strict().superRefine((v,ctx)=>{
  const exp=v.experience;
  const measured=exp.status==='measured'||exp.status==='bounded';
  if(v.N>v.D||exp.asOf!==v.asOf||
    (measured?(exp.lowerDays===null||exp.upperDays===null||exp.lowerDays>exp.upperDays):(exp.lowerDays!==null||exp.upperDays!==null))||
    v.N!==v.assessments.reduce((sum,a)=>sum+a.points,0)||v.D!==v.assessments.reduce((sum,a)=>sum+a.weight,0)||
    v.L!==v.assessments.reduce((sum,a)=>sum+a.localPoints,0)||
    new Set(v.assessments.flatMap(a=>a.criterionIds)).size!==v.assessments.flatMap(a=>a.criterionIds).length||
    v.assessments.some(a=>a.labels.length!==a.criterionIds.length||a.points!==(a.state==='met'?a.weight:0)||a.localPoints>a.points*1_000_000||(!a.mapped&&a.weight!==0))||
    Buffer.byteLength(JSON.stringify(v),'utf8')>24_576)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Invalid ranking assessment'});
});
export type RankedCandidate=z.infer<typeof rankedCandidateSchema>;
export const POLICY_VERSION = 'rubric-range-v1' as const;
export const TAXONOMY_VERSION = 'rubric-taxonomy-v3' as const;
export const ADAPTER_VERSION = 'rubric-evidence-v1' as const;
export const LOCAL_MATCH_VERSION = 'rubric-local-match-v3' as const;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort(byteCompare).map(k => JSON.stringify(k) + ':' + canonical((value as Record<string,unknown>)[k])).join(',') + '}';
  if(typeof value==='number') {
    if(!Number.isFinite(value))throw Error('RUBRIC_NON_JSON');
    const raw=String(value),parts=/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(raw);
    if(parts) {
      const integral=parts[2]!,digits=integral+(parts[3]??''),point=integral.length+Number(parts[4]);
      return parts[1]+(point<=0?'0.'+'0'.repeat(-point)+digits:
        point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));
    }
  }
  const result = JSON.stringify(value); if (result === undefined) throw Error('RUBRIC_NON_JSON'); return result;
}
export const byteCompare=(a:string,b:string):number=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
export function rankingHash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function rankingProjection(payload: BriefPayload): string {
  // Notes, source spans, JD and labels cannot affect matching. Criterion IDs remain bound in payload.
  return canonical(payload.criteria.map(c => ({subject:c.subject,class:c.class,requirement:c.requirement,evidenceKinds:c.evidenceKinds})).sort((a,b) => {
    return byteCompare(canonical(a),canonical(b));
  }));
}
const rankingContractBody = z.object({
  schemaVersion:z.literal(1), briefVersionId:z.string().uuid(), materialHash:hash,
  policyVersion:z.literal(POLICY_VERSION), taxonomyVersion:z.literal(TAXONOMY_VERSION),
  adapterVersion:z.literal(ADAPTER_VERSION), localMatchVersion:z.literal(LOCAL_MATCH_VERSION),
  payload:currentBriefPayloadSchema, projectionText:z.string().max(20000), projectionHash:hash,
}).strict();
export const rankingContractSchema = rankingContractBody.extend({contractHash:hash}).superRefine((v,ctx)=>{
  const {contractHash,...body}=v;
  if (rankingHash(body)!==contractHash || v.projectionText!==rankingProjection(v.payload) ||
      rankingHash(v.projectionText)!==v.projectionHash || Buffer.byteLength(canonical(v),'utf8')>32768) {
    ctx.addIssue({code:z.ZodIssueCode.custom,message:'Ranking contract binding mismatch'});
  }
});
export type RankingContract = z.infer<typeof rankingContractSchema>;
export type Criterion = BriefPayload['criteria'][number];
export function createRankingContract(briefVersionId:string, materialHash:string, rawPayload:unknown):RankingContract {
  const payload=currentBriefPayloadSchema.parse(rawPayload), projectionText=rankingProjection(payload);
  const body={schemaVersion:1 as const,briefVersionId,materialHash,policyVersion:POLICY_VERSION,taxonomyVersion:TAXONOMY_VERSION,
    adapterVersion:ADAPTER_VERSION,localMatchVersion:LOCAL_MATCH_VERSION,payload,projectionText,projectionHash:rankingHash(projectionText)};
  return rankingContractSchema.parse({...body,contractHash:rankingHash(body)});
}
