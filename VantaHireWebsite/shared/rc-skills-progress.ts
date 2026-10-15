import {z} from 'zod';

/** Counts-only public progress. No profile, provider payload or recovery command. */
export const signalRcProgressSchema=z.object({
 version:z.literal(1),
 state:z.enum(['queued','enriching_skills','partial','complete','stalled','closed_unrecoverable']),
 processed:z.number().int().min(0).max(300),total:z.number().int().min(0).max(300),
 updatedAt:z.string().datetime({offset:true}),notificationDelivered:z.boolean(),
 safeReason:z.enum(['worker_queue','quota_window','working','skills_unavailable','rate_unavailable','deadline','recovery_pending','closed']),
 workStarted:z.boolean().optional(),
}).strict().refine(value=>value.processed<=value.total&&
 (value.state==='queued'?typeof value.workStarted==='boolean'&&['worker_queue','quota_window'].includes(value.safeReason)&&
  (value.workStarted||(value.processed===0&&value.total===0)):value.workStarted===undefined&&!['worker_queue','quota_window'].includes(value.safeReason)),'Invalid progress');
export type SignalRcProgress=z.infer<typeof signalRcProgressSchema>;

/** Visual tone only; copy below is the single source of truth for every RC status surface. */
export type RcProgressTone='waiting'|'active'|'done'|'attention'|'failed'|'unknown';

export function rcProgressPresentation(progress:SignalRcProgress|undefined,unavailable=false):{heading:string;message:string;tone:RcProgressTone}{
 if(unavailable)return {tone:'unknown',heading:'Status temporarily unavailable',message:'Your saved search has not been restarted. Status will refresh when available.'};
 if(progress?.state==='stalled')return {tone:'attention',heading:'Search needs attention',message:'Saved work is retained for recovery. '+
  (progress.notificationDelivered?'Support has been notified.':'Support notification is pending.')};
 if(progress?.state==='closed_unrecoverable')return {tone:'failed',heading:'Search could not be completed',message:'Saved work is retained for review. This screen does not start another paid search.'};
 if(progress?.state==='complete'||progress?.state==='partial')return {tone:'done',heading:'Skills check finished',message:'Available skills are retained. Results appear once the shortlist has been saved.'};
 if(progress?.state==='queued'){
  const kept=progress.workStarted?' Profiles already processed are kept.':'';
  return progress.safeReason==='quota_window'
   ?{tone:'waiting',heading:'Skills check waiting',message:'Waiting for the skills provider’s next request window. Nothing is lost while it waits.'+kept}
   :{tone:'waiting',heading:'Skills check queued',message:'Waiting for a free worker. You can close this window while the search continues.'+kept};
 }
 return {tone:'active',heading:'Enriching skills',message:'You can close this window while the search continues.'};
}
