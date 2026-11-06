import {createHash} from 'node:crypto';
import type {FoundationDb} from './repository';

export const GLOBAL_BUDGET_ENV = [
 'SPARK_AI_GLOBAL_DAILY_USD','SPARK_AI_GLOBAL_MONTHLY_USD',
 'SPARK_OCR_GLOBAL_DAILY_USD','SPARK_OCR_GLOBAL_MONTHLY_USD',
 'SPARK_RC_GLOBAL_DAILY_CREDITS','SPARK_RC_GLOBAL_MONTHLY_CREDITS',
] as const;
export type GlobalBudgets={aiDayMicro:string;aiMonthMicro:string;ocrDayMicro:string;ocrMonthMicro:string;rcDayCredits:string;rcMonthCredits:string};
/** Release-owner input only. No runtime process can grant itself more spend. */
export function globalBudgetsFromEnv(env:NodeJS.ProcessEnv):GlobalBudgets|null{
 const values=GLOBAL_BUDGET_ENV.map(k=>env[k]);
 if(values.every(v=>v===undefined))return null;
 const parsed=values.map((v,i)=>{
  if(v===undefined||!(i<4?/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/:/^(0|[1-9]\d{0,14})$/).test(v))throw Error('spark_budget_configuration_invalid');
  const [whole,decimal='']=v.split('.');
  const n=i<4?BigInt(whole!)*1000000n+BigInt(decimal.padEnd(6,'0')):BigInt(whole!);
  if(n>9007199254740991n)throw Error('spark_budget_configuration_invalid');return n;
 });
 for(let i=0;i<6;i+=2)if(parsed[i]!>parsed[i+1]!)throw Error('spark_budget_configuration_invalid');
 const [aiDayMicro,aiMonthMicro,ocrDayMicro,ocrMonthMicro,rcDayCredits,rcMonthCredits]=parsed.map(String);
 return {aiDayMicro:aiDayMicro!,aiMonthMicro:aiMonthMicro!,ocrDayMicro:ocrDayMicro!,ocrMonthMicro:ocrMonthMicro!,rcDayCredits:rcDayCredits!,rcMonthCredits:rcMonthCredits!};
}
export async function applyGlobalBudgets(db:FoundationDb,budgets:GlobalBudgets):Promise<void>{
 const wire=JSON.stringify(budgets),digest=createHash('sha256').update(wire).digest('hex');
 await db.query('SELECT public.flow_candidate_source_global_configure($1,$2)',[budgets,digest]);
}
