import {lotSchema, type Lot} from './contracts';

type Reservation = {id: string; request: string; lotId: string; state: 'reserved'|'held'|'captured'|'released'};
export type Funding = {orgId: string; meter: Lot['meter']; payerSeats: string[];
  activeSeats: string[]; paidActive: boolean; freeEligible: boolean};

/** Sequential synthetic reference model, NOT a durable or concurrent ledger.
 * Real SQL must prove atomic grants, paired pack fulfilment and races separately.
 * Expiries are explicit: this model does not choose unresolved calendar rules. */
export class AllocationModel {
  private readonly lots = new Map<string, Lot>();
  private readonly events = new Map<string, string>();
  private readonly eventOwners = new Map<string, string>();
  private readonly reservations = new Map<string, Reservation>();

  grant(input: unknown): Lot {
    const lot = lotSchema.parse(input);
    const owner = this.eventOwners.get(lot.eventId);
    if (owner && owner !== lot.orgId) throw Error('payment_owner_conflict');
    const eventKey = JSON.stringify([lot.orgId, lot.eventId, lot.meter, lot.seatId]);
    const existing = this.events.get(eventKey);
    if (existing) {
      const previous = this.lots.get(existing)!;
      if (JSON.stringify(previous) !== JSON.stringify(lot)) throw Error('idempotency_conflict');
      return {...previous};
    }
    if (this.lots.has(lot.id)) throw Error('lot_id_conflict');
    this.lots.set(lot.id, {...lot}); this.events.set(eventKey, lot.id);this.eventOwners.set(lot.eventId,lot.orgId);
    return {...lot};
  }

  private remaining(lot: Lot): number {
    let occupied = 0;
    for (const r of this.reservations.values()) {
      if (r.lotId === lot.id && r.state !== 'released') occupied++;
    }
    return lot.quantity - occupied;
  }

  reserve(id: string, funding: Funding, now: number): Reservation | null {
    if (!Number.isSafeInteger(now) || now < 0 || !id) throw Error('invalid_request');
    // The immutable binding excludes changing eligibility/time; a replay is not a new spend.
    const request = JSON.stringify([funding.orgId, funding.meter, funding.payerSeats]);
    const previous = this.reservations.get(id);
    if (previous) {
      if (previous.request !== request) throw Error('idempotency_conflict');
      return {...previous};
    }
    const candidates = [...this.lots.values()].filter(lot =>
      lot.orgId === funding.orgId && lot.meter === funding.meter && lot.grantedAt <= now && now < lot.expiresAt
      && (lot.access === 'paid' ? funding.paidActive : funding.freeEligible)
      && (lot.meter === 'email' || lot.access === 'free' || (funding.payerSeats.includes(lot.seatId!) && funding.activeSeats.includes(lot.seatId!)))
      && this.remaining(lot) > 0);
    candidates.sort((a, b) => {
      // Poster first, actor fallback; earliest expiry within the eligible payer slot.
      const seat = funding.meter === 'search'
        ? funding.payerSeats.indexOf(a.seatId!) - funding.payerSeats.indexOf(b.seatId!) : 0;
      return seat || a.expiresAt - b.expiresAt || a.grantedAt - b.grantedAt || a.id.localeCompare(b.id);
    });
    const lot = candidates[0];
    if (!lot) return null;
    const r: Reservation = {id, request, lotId: lot.id, state: 'reserved'};
    this.reservations.set(id, r); return {...r};
  }

  settle(id: string, outcome: 'found'|'definite_no_charge'|'unknown'): Reservation {
    const r = this.reservations.get(id);
    if (!r) throw Error('not_found');
    const state = outcome === 'found' ? 'captured' : outcome === 'unknown' ? 'held' : 'released';
    if (r.state === 'captured' || r.state === 'released') {
      if (r.state !== state) throw Error('terminal_conflict');
      return {...r};
    }
    r.state = state; return {...r};
  }

  inspect(): {lots: Array<Lot & {remaining: number}>; reservations: Reservation[]} {
    return {lots: [...this.lots.values()].map(lot => ({...lot, remaining: this.remaining(lot)})),
      reservations: [...this.reservations.values()].map(r => ({...r}))};
  }
}
