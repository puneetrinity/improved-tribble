import {z} from 'zod';

/** Counts-only public progress. No profile, provider payload or recovery command. */
export const signalRcProgressSchema=z.object({
 version:z.literal(1),
 state:z.enum(['enriching_skills','partial','complete','stalled','closed_unrecoverable']),
 processed:z.number().int().min(0).max(300),total:z.number().int().min(0).max(300),
 updatedAt:z.string().datetime({offset:true}),notificationDelivered:z.boolean(),
 safeReason:z.enum(['working','skills_unavailable','rate_unavailable','deadline','recovery_pending','closed']),
}).strict().refine(value=>value.processed<=value.total,'Invalid progress');
export type SignalRcProgress=z.infer<typeof signalRcProgressSchema>;

export function rcProgressPresentation(progress:SignalRcProgress|undefined,unavailable=false){
 if(unavailable)return {heading:'Status temporarily unavailable',message:'Your saved search has not been restarted. Status will refresh when available.'};
 if(progress?.state==='stalled')return {heading:'Search needs attention',message:'Saved work is retained for recovery. '+
  (progress.notificationDelivered?'Support has been notified.':'Support notification is pending.')};
 if(progress?.state==='closed_unrecoverable')return {heading:'Search could not be completed',message:'Saved work is retained for review. This screen does not start another paid search.'};
 if(progress?.state==='complete'||progress?.state==='partial')return {heading:'Skills check finished',message:'Available skills are retained. Results appear once the shortlist has been saved.'};
 return {heading:'Enriching skills',message:'You can close this window while the search continues.'};
}
