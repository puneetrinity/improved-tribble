import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AllocationModel} from './allocation-model';
import {UnlockModel, type UnlockContext} from './unlock-model';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const setup = (credits = 2) => {
  const ledger = new AllocationModel();
  if (credits) ledger.grant({id: id(10), eventId: id(11), orgId: id(1), seatId: null, meter: 'email', access: 'paid', quantity: credits, grantedAt: 1, expiresAt: 100});
  const model = new UnlockModel(ledger);
  const context: UnlockContext = {orgId: id(1), candidateId: id(2), jobId: id(3), receiptId: id(4), authorised: true,
    privacyAllowed: true, networkActive: true, appliedOrg: false, existingJobBeforeWithdrawal: false,suppressed:false,
    funding: {orgId: id(1), meter: 'email', payerSeats: [], activeSeats: [], paidActive: true, freeEligible: false}, evidence: 'missing'};
  return {ledger, model, context};
};
test('no funds: no paid dispatch; shortlist itself is outside this model and remains independent', () => {
  const {model, context} = setup(0);
  const r = model.start(id(500), context, 20);
  assert.equal(r.result.state, 'exhausted'); assert.equal(r.providerDispatch, false);
});
test('reserve before dispatch, same-person attempts share one operation, lost replies do not rebuy', () => {
  const {model, ledger, context} = setup();
  assert.equal(model.start(id(500), context, 20).providerDispatch, true);
  assert.equal(ledger.inspect().lots[0]!.remaining, 1);
  assert.equal(model.start(id(501), {...context, jobId: id(30)}, 20).providerDispatch, false);
  model.finish(id(500), 'unknown', true);
  assert.equal(model.start(id(502), context, 21).result.reason, 'outcome_unknown');
  assert.equal(model.start(id(500), context, 21).providerDispatch, false);
  model.finish(id(500), 'found', true); model.finish(id(500), 'found', true);
  assert.equal(model.start(id(503), {...context, jobId: id(30)}, 22).result.reason, 'already_owned');
  assert.equal(ledger.inspect().reservations.length, 1);
});
for (const evidence of ['candidate_verified', 'fullenrich', 'enrichlayer'] as const) {
  test(`${evidence}: Memory reuse captures one org credit without a provider call`, () => {
    const {model, ledger, context} = setup();
    const r = model.start(id(500), {...context, evidence}, 20);
    assert.equal(r.result.state, 'available'); assert.equal(r.providerDispatch, false);
    assert.equal(ledger.inspect().reservations[0]!.state, 'captured');
    assert.equal(model.start(id(501), {...context, evidence}, 21).result.reason, 'already_owned');
    assert.equal(ledger.inspect().lots[0]!.remaining, 1);
  });
}
test('each org has its own debit while eligible evidence is reusable', () => {
  const {model, ledger, context} = setup();
  ledger.grant({id: id(20), eventId: id(21), orgId: id(9), seatId: null, meter: 'email', access: 'paid', quantity: 1, grantedAt: 1, expiresAt: 100});
  for (const org of [id(1), id(9)]) {
    const c = {...context, orgId: org, funding: {...context.funding, orgId: org}, evidence: 'fullenrich' as const};
    assert.equal(model.start(org, c, 20).providerDispatch, false);
  }
  assert.equal(ledger.inspect().reservations.filter(r => r.state === 'captured').length, 2);
});
test('applied org gets available bundle free; never authorises an unfunded provider call', () => {
  const {model, ledger, context} = setup(0);
  const c = {...context, appliedOrg: true};
  assert.equal(model.start(id(500), c, 20).providerDispatch, false);
  const r = model.start(id(501), {...c, evidence: 'candidate_verified'}, 21);
  assert.equal(r.result.reason, 'application_free'); assert.equal(ledger.inspect().reservations.length, 0);
});
test('privacy refusal and withdrawal deny new unlocks without consuming credit', () => {
  for (const change of [{authorised: false}, {privacyAllowed: false}, {networkActive: false}]) {
    const {model, ledger, context} = setup();
    const r = model.start(id(500), {...context, ...change}, 20);
    assert.equal(r.result.state, 'denied'); assert.equal(r.providerDispatch, false);
    assert.equal(ledger.inspect().reservations.length, 0);
  }
});
test('late result after authority loss is not charged or disclosed', () => {
  const {model, ledger, context} = setup(); model.start(id(500), context, 20);
  assert.equal(model.finish(id(500), 'found', false).state, 'denied');
  assert.equal(ledger.inspect().lots[0]!.remaining, 2);
});
test('withdrawal keeps only trusted existing-job access; lapse alone cannot revoke it', () => {
  const {model, context} = setup(); model.start(id(500), {...context, evidence: 'candidate_verified'}, 20);
  const c = {...context, networkActive: false, funding: {...context.funding, paidActive: false}};
  assert.equal(model.start(id(501), c, 21).result.reason, 'withdrawn');
  assert.equal(model.start(id(502), {...c, existingJobBeforeWithdrawal: true}, 21).result.state, 'available');
  assert.equal(model.start(id(503), {...c, existingJobBeforeWithdrawal: true, privacyAllowed: false}, 21).result.state, 'denied');
});
test('reusing request key for another identity fails; no contacts in status output', () => {
  const {model, context} = setup(); const r = model.start(id(500), context, 20);
  assert.throws(() => model.start(id(500), {...context, candidateId: id(99)}, 20), /idempotency_conflict/);
  assert.deepEqual(Object.keys(r.result).sort(), ['reason', 'receiptId', 'schemaVersion', 'state','withdrawalLabel','withdrawnAt']);
});
test('suppression refuses Spark and provider paths without reserving a credit',()=>{
 for(const evidence of ['candidate_verified','missing'] as const){
  const {model,ledger,context}=setup();const r=model.start(id(500),{...context,evidence,suppressed:true},20);
  assert.equal(r.result.reason,'suppressed');assert.equal(r.providerDispatch,false);assert.equal(ledger.inspect().reservations.length,0);
 }
});
test('paid found after lost authority is retained privately and reused without buying again',()=>{
 const {model,ledger,context}=setup();model.start(id(500),context,20);
 assert.equal(model.finish(id(500),'found',false).state,'denied');
 assert.equal(model.start(id(501),{...context,suppressed:true},21).providerDispatch,false);
 const r=model.start(id(502),context,22);
 assert.equal(r.providerDispatch,false);assert.equal(r.result.state,'available');
 assert.equal(ledger.inspect().reservations.filter(r=>r.state==='captured').length,1);
});
test('audit distinguishes free applied-org access; frozen access carries withdrawal date',()=>{
 const {model,context}=setup();model.start(id(500),{...context,appliedOrg:true,evidence:'candidate_verified'},20);
 assert.equal(model.inspectAudit()[0].fundingKind,'application_free');
 const r=model.start(id(501),{...context,networkActive:false,existingJobBeforeWithdrawal:true,withdrawnAt:'2026-10-30T00:00:00.000Z'},21);
 assert.equal(r.result.withdrawalLabel,'Withdrawn from network');assert.equal(r.result.withdrawnAt,'2026-10-30T00:00:00.000Z');
});
test('a key that joined another pending operation cannot be rebound to another candidate', () => {
  const {model, context} = setup();
  model.start(id(500), context, 20); model.start(id(501), context, 20);
  assert.throws(() => model.start(id(501), {...context, candidateId: id(99)}, 21), /idempotency_conflict/);
});
