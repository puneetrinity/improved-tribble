// E0 executable contract only. No route, database grant or provider is registered.
import {z} from 'zod';

const id = z.string().uuid();
const integer = z.number().int().nonnegative().safe();
/** UTC billing-calendar addition, clamped at month end; timestamps are ms. */
export function expiryCeiling(grantedAt:number,months:number):number {
  const d=new Date(grantedAt),day=d.getUTCDate();
  if(!Number.isFinite(d.getTime()))throw Error('invalid_grant_time');
  d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
  const end=new Date(d.getTime());end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
  d.setUTCDate(Math.min(day,end.getUTCDate()));return d.getTime();
}
export const unlockRequestSchema = z.object({
  schemaVersion: z.literal(1), action: z.literal('unlock'), idempotencyKey: id,
}).strict();
// Org, job, subject, price, source and funding never come from this DTO.
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;

const reason = z.enum(['reserved', 'outcome_unknown', 'unlocked', 'already_owned',
  'application_free', 'no_balance', 'access_denied', 'withdrawn', 'not_found',
  'privacy_changed', 'subscription_inactive', 'suppressed', 'not_unlocked']);
export const accessResultSchema = z.object({
  schemaVersion: z.literal(1),
  state: z.enum(['locked', 'pending', 'available', 'denied', 'exhausted']),
  reason, receiptId: id.nullable(),
  withdrawnAt: z.string().datetime().nullable().default(null),
  withdrawalLabel: z.literal('Withdrawn from network').nullable().default(null),
}).strict().superRefine((v, ctx) => {
  const allowed: Record<string, string[]> = {
    locked: ['not_found', 'not_unlocked'], pending: ['reserved', 'outcome_unknown'],
    available: ['unlocked', 'already_owned', 'application_free'],
    denied: ['access_denied', 'withdrawn', 'privacy_changed', 'subscription_inactive', 'suppressed'],
    exhausted: ['no_balance'],
  };
  if (!allowed[v.state]?.includes(v.reason) || ((v.state === 'available') !== (v.receiptId !== null))
    || ((v.withdrawnAt === null) !== (v.withdrawalLabel === null))) {
    ctx.addIssue({code: z.ZodIssueCode.custom, message: 'invalid_access_result'});
  }
});
export type AccessResult = z.infer<typeof accessResultSchema>;

// Internal inputs must be resolved from verified billing events, never browser data.
export const lotSchema = z.object({
  id, eventId: id, orgId: id, seatId: id.nullable(),
  meter: z.enum(['search', 'email']), access: z.enum(['free', 'paid']),
  billingPeriod:z.enum(['monthly','annual']).default('monthly'),
  quantity: integer.min(1), grantedAt: integer, expiresAt: integer,
}).strict().superRefine((v, ctx) => {
  if (v.expiresAt <= v.grantedAt || (v.meter === 'email' && v.seatId !== null)
    || (v.meter === 'search' && v.access === 'paid' && v.seatId === null)
    || (v.access === 'free' && v.seatId !== null)
    || v.expiresAt>expiryCeiling(v.grantedAt,v.access==='free'?1:v.billingPeriod==='annual'?24:3)) {
    ctx.addIssue({code: z.ZodIssueCode.custom, message: 'invalid_lot'});
  }
});
export type Lot = z.infer<typeof lotSchema>;

export const POLICY = Object.freeze({
  monthlyPricePaise: 899900, annualPricePaise: 9898900, gstPercent: 18,
  paidMonthlySearches: 5, paidMonthlyEmails: 500,
  paidAnnualSearches: 60, paidAnnualEmails: 6000,
  freeMonthlySearches: 1, freeMonthlyEmails: 10, freePublicationEvents: 10,
  packSearches: 5, packEmails: 500, packPricePaise: 899900,
});

/** Integer rational arithmetic: allowance ceiling, NOT monetary rounding.
 * Remaining/term are supplied by the future reviewed billing calendar adapter. */
export function proratedUnits(full: number, remaining: bigint, term: bigint): number {
  integer.parse(full);
  if (term <= 0n || remaining < 0n || remaining > term) throw Error('invalid_term');
  const units = (BigInt(full) * remaining + term - 1n) / term;
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('quantity_overflow');
  return Number(units);
}
