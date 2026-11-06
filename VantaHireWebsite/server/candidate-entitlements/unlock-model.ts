import {accessResultSchema, type AccessResult} from './contracts';
import {AllocationModel, type Funding} from './allocation-model';

export type UnlockContext = {
  orgId: string; candidateId: string; jobId: string; receiptId: string;
  authorised: boolean; privacyAllowed: boolean; networkActive: boolean;
  appliedOrg: boolean; existingJobBeforeWithdrawal: boolean;
  suppressed: boolean; withdrawnAt?: string;
  funding: Funding;
  evidence: 'candidate_verified'|'fullenrich'|'enrichlayer'|'missing';
};
type Operation = {binding: string; orgCandidate: string; candidateId: string; reservation: string | null;
  fundingKind:'application_free'|'credit';
  state: 'pending'|'held'|'available'|'not_found'|'evidence_retained'; receiptId: string};
type Start = {result: AccessResult; providerDispatch: boolean; operationId: string | null};
const result = (state: AccessResult['state'], reason: AccessResult['reason'], receiptId: string | null = null): AccessResult =>
  accessResultSchema.parse({schemaVersion: 1, state, reason, receiptId});

/** No contacts are stored here. Trusted evidence/authority decisions are injected.
 * This model is NOT an authorisation service or a production provider journal.
 * Receipt IDs are preallocated by the trusted test caller, not browser requests. */
export class UnlockModel {
  private readonly operations = new Map<string, Operation>();
  private readonly requestBindings = new Map<string, string>();
  private readonly entitlements = new Map<string, string>();
  private readonly active = new Map<string, string>();
  // Evidence presence only; the durable implementation stores the contact once
  // in restricted Memory, never in this access/credit record or a browser DTO.
  private readonly retainedEvidence = new Set<string>();
  constructor(private readonly ledger: AllocationModel) {}

  start(id: string, c: UnlockContext, now: number): Start {
    const key = JSON.stringify([c.orgId, c.candidateId]);
    const binding = JSON.stringify([c.orgId, c.candidateId, c.jobId]);
    if (c.funding.orgId !== c.orgId || c.funding.meter !== 'email') throw Error('invalid_funding');
    if (!c.authorised || !c.privacyAllowed) return {result: result('denied', 'access_denied'), providerDispatch: false, operationId: null};
    if(c.suppressed!==false)return {result:result('denied','suppressed'),providerDispatch:false,operationId:null};
    const priorBinding = this.requestBindings.get(id);
    if (priorBinding && priorBinding !== binding) throw Error('idempotency_conflict');
    this.requestBindings.set(id, binding);
    const prior = this.operations.get(id);
    const owned = this.entitlements.get(key);
    if (!c.networkActive && !(owned && c.existingJobBeforeWithdrawal)) {
      return {result: result('denied', 'withdrawn'), providerDispatch: false, operationId: null};
    }
    if (owned) return {result: accessResultSchema.parse({...result('available', 'already_owned', owned),
      withdrawnAt:!c.networkActive?c.withdrawnAt??null:null,withdrawalLabel:!c.networkActive&&c.withdrawnAt?'Withdrawn from network':null}), providerDispatch: false, operationId: null};
    if(prior?.state==='evidence_retained')return {result:result('denied','privacy_changed'),providerDispatch:false,operationId:id};
    if (prior) return {result: prior.state === 'not_found' ? result('locked', 'not_found')
      : result('pending', prior.state === 'held' ? 'outcome_unknown' : 'reserved'), providerDispatch: false, operationId: id};
    const pending = this.active.get(key);
    if (pending) {
      const operation = this.operations.get(pending)!;
      return {result: result('pending', operation.state === 'held' ? 'outcome_unknown' : 'reserved'), providerDispatch: false, operationId: pending};
    }
    if (!c.appliedOrg && !c.funding.paidActive && !c.funding.freeEligible) {
      return {result: result('denied', 'subscription_inactive'), providerDispatch: false, operationId: null};
    }
    // Validate receipt before mutating any model state.
    result('available', 'unlocked', c.receiptId);
    const reservation = c.appliedOrg ? null : this.ledger.reserve(id, c.funding, now);
    if (!c.appliedOrg && !reservation) return {result: result('exhausted', 'no_balance'), providerDispatch: false, operationId: null};
    const op: Operation = {binding, orgCandidate: key,candidateId:c.candidateId,fundingKind:c.appliedOrg?'application_free':'credit', reservation: reservation?.id ?? null, state: 'pending', receiptId: c.receiptId};
    this.operations.set(id, op); this.active.set(key, id);
    if (c.evidence !== 'missing'||this.retainedEvidence.has(c.candidateId)) {
      const accepted = this.finish(id, 'found', true);
      return {result: c.appliedOrg ? result('available', 'application_free', c.receiptId) : accepted, providerDispatch: false, operationId: id};
    }
    // Applied-org access is free, but it never authorises an unfunded provider call.
    if (c.appliedOrg) {
      this.finish(id, 'not_found', true);
      return {result: result('locked', 'not_found'), providerDispatch: false, operationId: id};
    }
    return {result: result('pending', 'reserved'), providerDispatch: true, operationId: id};
  }

  finish(id: string, outcome: 'found'|'not_found'|'unknown', currentlyEligible: boolean): AccessResult {
    const op = this.operations.get(id);
    if (!op) throw Error('not_found');
    if(op.state==='evidence_retained'){
      if(outcome!=='found')throw Error('terminal_conflict');
      return result('denied','privacy_changed');
    }
    if (op.state === 'available') {
      if (outcome !== 'found') throw Error('terminal_conflict');
      return currentlyEligible ? result('available', 'already_owned', op.receiptId) : result('denied', 'privacy_changed');
    }
    if (op.state === 'not_found') {
      if (outcome !== 'not_found') throw Error('terminal_conflict');
      return result('locked', 'not_found');
    }
    if (outcome === 'unknown') {
      if (op.reservation) this.ledger.settle(op.reservation, 'unknown');
      op.state = 'held'; return result('pending', 'outcome_unknown');
    }
    if (outcome === 'not_found' || !currentlyEligible) {
      // Customer reservation only. Provider usage is a separate journal and is NOT refunded here.
      if (op.reservation) this.ledger.settle(op.reservation, 'definite_no_charge');
      if(outcome==='found')this.retainedEvidence.add(op.candidateId);
      op.state = outcome==='found'?'evidence_retained':'not_found'; this.active.delete(op.orgCandidate);
      return currentlyEligible ? result('locked', 'not_found') : result('denied', 'privacy_changed');
    }
    if (op.reservation) this.ledger.settle(op.reservation, 'found');
    this.retainedEvidence.add(op.candidateId);
    op.state = 'available'; this.entitlements.set(op.orgCandidate, op.receiptId); this.active.delete(op.orgCandidate);
    return result('available', op.fundingKind==='application_free'?'application_free':'unlocked', op.receiptId);
  }
  inspectAudit(){return [...this.operations.values()].map(op=>({candidateId:op.candidateId,fundingKind:op.fundingKind,state:op.state}));}
}
