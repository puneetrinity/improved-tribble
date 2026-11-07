import {z} from 'zod';
import type {FoundationDb} from './repository';
import {getEmailService} from '../simpleEmailService';
const alert=z.object({id:z.string().uuid(),token:z.string().uuid(),feature:z.enum(['ai','ocr','rc']),metric:z.string().regex(/^[a-z_]{1,60}$/),used:z.string().regex(/^\d+(\.\d+)?$/),cap:z.string().regex(/^\d+(\.\d+)?$/)}).strict();
export type BudgetAlert=z.infer<typeof alert>;
export async function sendBudgetAlert(a:BudgetAlert,env:NodeJS.ProcessEnv=process.env):Promise<boolean>{
 const to=env.FLOW_OPS_ALERT_EMAIL;
 if(!to||!/^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(to))return false;
 try{
  const service=await getEmailService();if(!service)return false;
  const subject=a.feature==='ai'&&a.metric==='shutdown_overrun'
   ?'ealana spark: AI auto-disabled after overrun — review required'
   :a.feature==='ai'&&a.metric==='shutdown_review_required'?'ealana spark: AI disabled — review required'
   :`ealana spark: ${a.feature} budget warning`;
  return await service.sendEmail({to,subject,
   text:`Alert: ${a.id}\nFeature: ${a.feature}\nLimit: ${a.metric}\nUsed/reserved: ${a.used}\nCap: ${a.cap}\nUSD metrics are in millionths of a dollar. Other metrics are counts.\nReview usage before increasing limits. No automatic retry of uncertain paid calls.\nNo candidate identity is included.`});
 }catch{return false;}
}
export async function deliverBudgetAlerts(db:FoundationDb,send:(a:BudgetAlert)=>Promise<boolean>=sendBudgetAlert):Promise<number>{
 let count=0;
 for(let i=0;i<20;i++){
  const value=(await db.query('SELECT public.flow_candidate_source_budget_alert_claim() result',[])).rows[0]?.result;
  if(value===null)return count;const a=alert.parse(value);
  let sent=false;try{sent=await send(a);}catch{/* retry after durable cooldown */}
  await db.query('SELECT public.flow_candidate_source_budget_alert_finish($1,$2,$3)',[a.id,a.token,sent]);
  if(sent)count++;
 }
 return count;
}
export function startBudgetAlerts(db:FoundationDb,enabled:()=>boolean,send:(a:BudgetAlert)=>Promise<boolean>=sendBudgetAlert):()=>Promise<void>{
 let active:Promise<unknown>|undefined,stopped=false;
 const tick=()=>{if(stopped||active||!enabled())return;active=deliverBudgetAlerts(db,send).catch(()=>console.warn('[spark-budget] alert delivery unavailable')).finally(()=>{active=undefined;});};
 const timer=setInterval(tick,30000);timer.unref();tick();
 return async()=>{stopped=true;clearInterval(timer);await active;};
}

/** One best-effort operator email for a configuration fault found at startup. Fixed text only:
 * never a key, value or candidate detail. Returns false when no alert address or email service. */
export async function sendConfigurationAlert(code:'candidate_lookup_configuration_required',env:NodeJS.ProcessEnv=process.env):Promise<boolean>{
 const to=env.FLOW_OPS_ALERT_EMAIL;
 if(!to||!/^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(to))return false;
 try{
  const service=await getEmailService();if(!service)return false;
  return await service.sendEmail({to,subject:'ealana spark: candidate lookup switched off — configuration required',
   text:`Problem: ${code}\nCANDIDATE_RC_API_KEY is missing or malformed, so the candidate profile lookup is off.\nEverything else started normally. Candidates continue onboarding with a résumé or by typing their details.\nFix the variable and redeploy Flow web to switch the lookup back on.`});
 }catch{return false;}
}
