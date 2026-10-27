import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { foundationIntentCaptureEnabled } from './config';
import { intentSchema,intentPurposes,parseStrictJson } from './contracts';

/** Same outer intake transaction, separate savepoint. Never throws an optional
 * intent failure into the successful application/signup transaction. No PII logs. */
export async function captureOptionalIntent(executor:any,kind:'guest'|'signup',id:number,input:unknown):Promise<'recorded'|'not_recorded'|undefined> {
  if(input===undefined || input===false) return undefined;
  if(!foundationIntentCaptureEnabled()) return 'not_recorded';
  let decoded:unknown=input;
  try { if(typeof input==='string') decoded=parseStrictJson(input); }
  catch { return 'not_recorded'; }
  if(decoded===false) return undefined;
  const parsed=intentSchema.safeParse(decoded);
  if(!parsed.success) return 'not_recorded';
  try {
    await executor.transaction(async (savepoint:any)=>{
      await savepoint.execute(sql`SELECT public.flow_candidate_foundation_intent(
        ${kind}::text,${id}::integer,${randomUUID()}::uuid,${parsed.data.copyVersion}::integer,
        ${parsed.data.copySha256}::text,${JSON.stringify(intentPurposes)}::jsonb)`);
    });
    return 'recorded';
  } catch { return 'not_recorded'; }
}
