import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unlockRequestSchema, accessResultSchema, lotSchema, POLICY, proratedUnits,expiryCeiling} from './contracts';
const id = '00000000-0000-4000-8000-000000000001';
test('browser unlock contains no authority, funding or contact fields', () => {
  const valid = {schemaVersion: 1, action: 'unlock', idempotencyKey: id};
  assert.deepEqual(unlockRequestSchema.parse(valid), valid);
  for (const field of ['orgId', 'candidateId', 'jobId', 'price', 'email', 'payerSeat', 'appliedOrg']) {
    assert.equal(unlockRequestSchema.safeParse({...valid, [field]: 'forged'}).success, false);
  }
  assert.equal(unlockRequestSchema.safeParse({...valid, idempotencyKey: 'bad'}).success, false);
});
test('access status excludes contact values and cross-state receipts', () => {
  const valid = {schemaVersion: 1, state: 'available', reason: 'unlocked', receiptId: id};
  assert.deepEqual(accessResultSchema.parse(valid), {...valid,withdrawnAt:null,withdrawalLabel:null});
  for (const value of [{...valid, email: 'private@example.invalid'}, {...valid, receiptId: null},
    {...valid, state: 'pending'}, {...valid, reason: 'no_balance'}]) {
    assert.equal(accessResultSchema.safeParse(value).success, false);
  }
});
test('Free, monthly and annual balances cannot roll past their approved ceilings',()=>{
 const grantedAt=Date.UTC(2026,0,31);
 for(const [access,billingPeriod,months]of [['free','monthly',1],['paid','monthly',3],['paid','annual',24]] as const){
  const v={id,eventId:id,orgId:id,seatId:null,meter:'email',access,billingPeriod,quantity:10,grantedAt,expiresAt:expiryCeiling(grantedAt,months)};
  assert.equal(lotSchema.safeParse(v).success,true);
  assert.equal(lotSchema.safeParse({...v,expiresAt:v.expiresAt+1}).success,false);
 }
 assert.equal(expiryCeiling(grantedAt,1),Date.UTC(2026,1,28));
 assert.equal(accessResultSchema.safeParse({schemaVersion:1,state:'locked',reason:'not_unlocked',receiptId:null}).success,true);
});
test('lot contract validates expiry, safe integer units and seat partition', () => {
  const valid = {id, eventId: id, orgId: id, seatId: null, meter: 'email', access: 'paid', quantity: 500, grantedAt: 1, expiresAt: 2};
  assert.equal(lotSchema.safeParse(valid).success, true);
  for (const value of [{...valid, quantity: 1.5}, {...valid, quantity: 0}, {...valid, expiresAt: 1},
    {...valid, seatId: id}, {...valid, meter: 'search'}, {...valid, quantity: Number.MAX_SAFE_INTEGER + 1}]) {
    assert.equal(lotSchema.safeParse(value).success, false);
  }
});
test('approved policy arithmetic and allowance ceiling use exact rationals', () => {
  assert.equal(POLICY.annualPricePaise, POLICY.monthlyPricePaise * 11);
  assert.equal(POLICY.paidAnnualSearches, POLICY.paidMonthlySearches * 12);
  assert.equal(POLICY.paidAnnualEmails, POLICY.paidMonthlyEmails * 12);
  assert.equal(POLICY.monthlyPricePaise * 118 / 100, 1061882);
  assert.equal(POLICY.annualPricePaise * 118 / 100, 11680702);
  assert.equal(proratedUnits(5, 1n, 2n), 3);
  assert.equal(proratedUnits(500, 1n, 3n), 167);
  assert.equal(proratedUnits(2, 1n, 1n), 2);
  assert.equal(proratedUnits(60, 0n, 12n), 0);
  assert.throws(() => proratedUnits(5, 2n, 1n), /invalid_term/);
});
