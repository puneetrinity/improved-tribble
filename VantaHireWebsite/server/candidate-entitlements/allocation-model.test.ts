import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AllocationModel, type Funding} from './allocation-model';
import type {Lot} from './contracts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const lot = (n: number, extra: Partial<Lot> = {}): Lot => ({id: id(n), eventId: id(n + 100), orgId: id(1),
  seatId: null, meter: 'email', access: 'paid', billingPeriod:'monthly', quantity: 1, grantedAt: 10, expiresAt: 100, ...extra});
const funding = (extra: Partial<Funding> = {}): Funding => ({orgId: id(1), meter: 'email', payerSeats: [], activeSeats: [], paidActive: true, freeEligible: false, ...extra});
test('grant replays once, changed event conflicts, input/output cannot mutate state', () => {
  const m = new AllocationModel(), l = lot(10);
  m.grant(l); m.grant(l);
  assert.equal(m.inspect().lots.length, 1);
  assert.throws(() => m.grant({...l, quantity: 2}), /idempotency_conflict/);
  assert.throws(() => m.grant({...l, eventId: id(900)}), /lot_id_conflict/);
  l.quantity = 100; m.inspect().lots[0]!.quantity = 100;
  assert.equal(m.inspect().lots[0]!.quantity, 1);
});
test('earliest expiry across lots, no expired/future/foreign funding', () => {
  const m = new AllocationModel();
  for (const l of [lot(10), lot(11, {expiresAt: 50}), lot(12, {expiresAt: 20}),
    lot(13, {grantedAt: 30}), lot(14, {orgId: id(2), expiresAt: 25})]) m.grant(l);
  assert.equal(m.reserve(id(501), funding(), 20)?.lotId, id(11));
  assert.equal(m.reserve(id(502), funding(), 20)?.lotId, id(10));
  assert.equal(m.reserve(id(503), funding(), 20), null);
});
test('poster first then actor, inactive slots paused without transfer', () => {
  const m = new AllocationModel();
  m.grant(lot(10, {meter: 'search', seatId: id(40), expiresAt: 90}));
  m.grant(lot(11, {meter: 'search', seatId: id(41), expiresAt: 50}));
  const f = funding({meter: 'search', payerSeats: [id(40), id(41)], activeSeats: [id(40), id(41)]});
  assert.equal(m.reserve(id(501), f, 20)?.lotId, id(10));
  assert.equal(m.reserve(id(502), {...f, activeSeats: []}, 20), null);
  assert.equal(m.reserve(id(502), f, 20)?.lotId, id(11));
  assert.equal(m.reserve(id(503), f, 100), null);
});
test('lapse pauses paid lots, Free included lots remain separately eligible', () => {
  const m = new AllocationModel(); m.grant(lot(10)); m.grant(lot(11, {access: 'free'}));
  assert.equal(m.reserve(id(501), funding({paidActive: false}), 20), null);
  assert.equal(m.reserve(id(502), funding({paidActive: false, freeEligible: true}), 20)?.lotId, id(11));
  assert.equal(m.reserve(id(503), funding(), 20)?.lotId, id(10));
});
test('unknown outcomes retain units even after expiry; no duplicate capture', () => {
  const m = new AllocationModel(); m.grant(lot(10));
  m.reserve(id(501), funding(), 20); m.settle(id(501), 'unknown');
  assert.equal(m.reserve(id(502), funding(), 21), null);
  assert.equal(m.reserve(id(501), funding(), 200)?.state, 'held');
  m.settle(id(501), 'found'); m.settle(id(501), 'found');
  assert.equal(m.inspect().lots[0]!.remaining, 0);
  assert.throws(() => m.settle(id(501), 'definite_no_charge'), /terminal_conflict/);
});
test('definite miss releases once and request binding prevents cross-org replay', () => {
  const m = new AllocationModel(); m.grant(lot(10));
  m.reserve(id(501), funding(), 20); m.settle(id(501), 'definite_no_charge');
  assert.equal(m.inspect().lots[0]!.remaining, 1);
  assert.throws(() => m.reserve(id(501), funding({orgId: id(2)}), 20), /idempotency_conflict/);
  assert.equal(m.reserve(id(502), funding(), 20)?.state, 'reserved');
});
test('one payment cannot mint balances for another organisation',()=>{
 const m=new AllocationModel();m.grant(lot(10));
 assert.throws(()=>m.grant(lot(20,{eventId:id(110),orgId:id(2)})),/payment_owner_conflict/);
 assert.equal(m.inspect().lots.length,1);
});
test('Free search is organisation-scoped and requires no invented seat',()=>{
 const m=new AllocationModel();m.grant(lot(10,{access:'free',meter:'search'}));
 assert.equal(m.reserve(id(501),funding({meter:'search',paidActive:false,freeEligible:true}),20)?.lotId,id(10));
});
