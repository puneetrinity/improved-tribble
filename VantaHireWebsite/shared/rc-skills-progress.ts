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
 if(unavailable)return {tone:'unknown',heading:'Status temporarily unavailable',message:'Your search is still saved. We’ll update the status when we can.'};
 if(progress?.state==='stalled')return {tone:'attention',heading:'Search needs attention',message:'Progress so far is saved. '+
  (progress.notificationDelivered?'Support has been notified.':'We’re letting support know.')};
 if(progress?.state==='closed_unrecoverable')return {tone:'failed',heading:'Search could not be completed',message:'Progress so far is saved. Closing this window won’t start or charge another search.'};
 if(progress?.state==='complete'||progress?.state==='partial')return {tone:'done',heading:'Skills check finished',message:'Your results are being prepared.'};
 if(progress?.state==='queued'){
  const kept=progress.workStarted?' Profiles already checked are kept.':'';
  return progress.safeReason==='quota_window'
   ?{tone:'waiting',heading:'Skills check waiting',message:'Skills checks are temporarily paused. They’ll continue automatically.'+kept}
   :{tone:'waiting',heading:'Skills check queued',message:(progress.workStarted?'The skills check is waiting its turn to continue. You can close this window.':'Your search is waiting to start. You can close this window.')+kept};
 }
 return {tone:'active',heading:'Checking candidate skills',message:'You can close this window while the search continues.'};
}
