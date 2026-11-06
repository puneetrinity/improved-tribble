import { z } from 'zod';
import { commandReadSchema,commandStatusSchema,foundationStatusSchema,intentClaimStatusSchema,uuid } from './contracts';

export interface FoundationDb {
  query(sql:string,values:unknown[]):Promise<{rows:Array<{result:unknown}>}>;
}
export interface FoundationAuthority {
  userId:number; authVersion:number; passwordVersion:string; reauthenticatedAt:number;
}
export class FoundationRepositoryError extends Error {
  constructor(public readonly code:string,public readonly status:number){super(code);}
}
const identity=z.object({userId:z.number().int().positive(),authVersion:z.number().int().nonnegative()});
const authority=identity.extend({passwordVersion:z.string().regex(/^[0-9a-f]{64}$/),reauthenticatedAt:z.number().int().nonnegative()});
// Both SQLSTATE and the routine's exact safe marker are required. Never expose a raw DB message.
const knownErrors:Readonly<Record<string,readonly [string,number]>>={
  not_found:['P0002',404],identity_changed:['42501',409],
  idempotency_conflict:['23505',409],intent_expired:['22023',409],invalid_request:['22023',400],
};

/** Runtime access is routine-only. Caller supplies the existing privacy authority check. */
export function foundationRepository(db:FoundationDb,checkPrivacy:(userId:number)=>Promise<void>){
  async function call<T>(sql:string,values:unknown[],schema:z.ZodType<T>):Promise<T>{
    try {
      const result=await db.query(sql,values);
      const row=result.rows[0];
      if(result.rows.length!==1||!row)throw Error('invalid_result');
      return schema.parse(row.result);
    } catch(error){
      const e=error as {code?:unknown;message?:unknown};
      const match=typeof e.message==='string'?knownErrors[e.message]:undefined;
      if(match&&e.code===match[0])throw new FoundationRepositoryError(e.message as string,match[1]);
      throw new FoundationRepositoryError('authority_unavailable',503);
    }
  }
  async function checked(actor:{userId:number;authVersion:number}){
    const parsed=identity.safeParse(actor);
    if(!parsed.success)throw new FoundationRepositoryError('invalid_request',400);
    await checkPrivacy(parsed.data.userId);
    return parsed.data;
  }
  function writeArgs(actor:FoundationAuthority,id:string){
    if(!authority.safeParse(actor).success||!uuid.safeParse(id).success)
      throw new FoundationRepositoryError('invalid_request',400);
    const date=new Date(actor.reauthenticatedAt);
    if(!Number.isFinite(date.getTime()))throw new FoundationRepositoryError('invalid_request',400);
    return [actor.userId,actor.authVersion,actor.passwordVersion,date.toISOString(),id];
  }
  return {
    async ensure(actor:FoundationAuthority,key:string){
      const args=writeArgs(actor,key);await checked(actor);
      return call('SELECT public.flow_candidate_foundation_ensure($1,$2,$3,$4,$5) AS result',args,commandStatusSchema);
    },
    async read(actor:{userId:number;authVersion:number}){
      const a=await checked(actor);
      return call('SELECT public.flow_candidate_foundation_read($1,$2) AS result',[a.userId,a.authVersion],foundationStatusSchema);
    },
    async readCommand(actor:{userId:number;authVersion:number},id:string){
      if(!uuid.safeParse(id).success)throw new FoundationRepositoryError('invalid_request',400);
      const a=await checked(actor);
      return call('SELECT public.flow_candidate_foundation_command_read($1,$2,$3) AS result',[a.userId,a.authVersion,id],commandReadSchema);
    },
    async claimIntent(actor:FoundationAuthority,id:string){
      const args=writeArgs(actor,id);await checked(actor);
      return call('SELECT public.flow_candidate_foundation_claim_intent($1,$2,$3,$4,$5) AS result',args,intentClaimStatusSchema);
    },
  };
}
