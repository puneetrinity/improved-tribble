import { createHash } from 'node:crypto';
import { z } from 'zod';
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const FOUNDATION_TABLES=['candidate_product_accounts','candidate_product_commands','candidate_product_outbox','candidate_network_intents'] as const;
export const FOUNDATION_FUNCTIONS=[
 'flow_candidate_foundation_ensure(integer,integer,text,timestamp with time zone,uuid)',
 'flow_candidate_foundation_read(integer,integer)',
 'flow_candidate_foundation_command_read(integer,integer,uuid)',
 'flow_candidate_foundation_claim_delivery(uuid)',
 'flow_candidate_foundation_finish_delivery(uuid,uuid,bigint,text,jsonb)',
 'flow_candidate_foundation_claim_intent(integer,integer,text,timestamp with time zone,uuid)',
 'flow_candidate_foundation_intent(text,integer,uuid,integer,text,jsonb)',
] as const;
export const FOUNDATION_OWNER_FUNCTIONS=['flow_candidate_foundation_command_immutable()','flow_candidate_foundation_application_delete()'] as const;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const foundationRequest = z.object({schemaVersion:z.literal(1),idempotencyKey:uuid}).strict();
export const foundationClaimRequest = z.object({schemaVersion:z.literal(1)}).strict();
export const safeReason = z.enum(['identity_changed','remote_conflict','remote_denied','retry_exhausted','invalid_response']);
export const commandStatusSchema = z.object({schemaVersion:z.literal(1),commandId:uuid,
  status:z.enum(['pending','acknowledged','held']),publicationActive:z.literal(false)}).strict();
export const commandReadSchema = commandStatusSchema.extend({reason:safeReason.nullable()}).strict();
export const foundationStatusSchema = z.object({schemaVersion:z.literal(1),state:z.enum(['not_started','pending','linked','held']),
  profileVersion:z.literal(0),preferenceVersion:z.literal(0),publicationActive:z.literal(false)}).strict();
export const intentClaimStatusSchema = z.object({schemaVersion:z.literal(1),status:z.literal('claimed'),
  requiresConfirmation:z.literal(true),publicationActive:z.literal(false)}).strict();
export const wireSchema = z.object({schemaVersion:z.literal(1),commandId:uuid,subjectId:uuid,bindingId:uuid,
  sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),action:z.literal('ensure_subject')}).strict();
export const receiptSchema = z.object({schemaVersion:z.literal(1),commandId:uuid,subjectId:uuid,bindingId:uuid,
  sequence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),wireSha256:hash,outcome:z.literal('subject_ready'),
  profileVersion:z.literal(0),preferenceVersion:z.literal(0),publicationActive:z.literal(false)}).strict();
export const draftIntentCopy = 'S1 synthetic intent fixture; not approved public consent copy.';
export const draftIntentHash = createHash('sha256').update(draftIntentCopy).digest('hex');
export const intentSchema = z.object({copyVersion:z.literal(1),copySha256:z.literal(draftIntentHash),accepted:z.literal(true)}).strict();
export const intentPurposes = ['matching','enrichment','recruiter_visibility','recruiter_job_email'] as const;
// Validate the original bytes before a schema sees JSON.parse's last-key-wins result.
export function parseStrictJson(raw: string): unknown {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 4096) throw new Error('invalid_contract');
  const value: unknown = JSON.parse(raw);
  let offset = 0;
  const whitespace = () => { while (/\s/.test(raw[offset] ?? '') && offset < raw.length) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < raw.length) {
      const character = raw[offset++];
      if (character === '\\') offset++;
      else if (character === '"') return JSON.parse(raw.slice(start, offset)) as string;
    }
    throw new Error('invalid_contract');
  };
  const visit = (depth: number): void => {
    whitespace();
    const opener = raw[offset];
    if (opener === '{' || opener === '[') {
      if (depth > 4) throw new Error('invalid_contract');
      offset++;
      const closer = opener === '{' ? '}' : ']';
      const keys = new Set<string>();
      whitespace();
      if (raw[offset] === closer) { offset++; return; }
      while (offset < raw.length) {
        whitespace();
        if (opener === '{') {
          const key = string();
          if (keys.has(key)) throw new Error('invalid_contract');
          keys.add(key);
          whitespace();
          offset++; // JSON.parse above already checked the colon and full syntax.
        }
        visit(depth + 1);
        whitespace();
        if (raw[offset++] === closer) return;
      }
      throw new Error('invalid_contract');
    }
    if (opener === '"') { string(); return; }
    while (offset < raw.length && !/[\s,\]}]/.test(raw[offset]!)) offset++;
  };
  visit(1);
  return value;
}
export function parseWire(raw:string) {
  if(Buffer.byteLength(raw,'utf8')>4096) throw new Error('invalid_contract');
  const value=wireSchema.parse(parseStrictJson(raw));
  const canonical=JSON.stringify({schemaVersion:value.schemaVersion,commandId:value.commandId,
    subjectId:value.subjectId,bindingId:value.bindingId,sequence:value.sequence,action:value.action});
  if(raw!==canonical) throw new Error('invalid_contract');
  return {value,hash:createHash('sha256').update(raw).digest('hex')};
}
