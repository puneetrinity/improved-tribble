import { describe, expect, it } from 'vitest';
import {
  parseSourcingBody, sourcingAdmissionSchema, sourcingDecisionSchema,
  sourcingEnabled, sourcingHash, sourcingMonthlyWindow, sourcingPreviewRequestSchema,
} from '../contracts';

const id = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const decision = { requestId: id, expectedRevision: 0, action: 'pass' };

describe('governed sourcing closed contracts', () => {
  it('stays off by default and requires the approved-brief feature', () => {
    expect(sourcingEnabled({})).toBe(false);
    expect(sourcingEnabled({ FLOW_SOURCING_V1_ENABLED: 'false' })).toBe(false);
    expect(() => sourcingEnabled({ FLOW_SOURCING_V1_ENABLED: 'true' })).toThrow('BRIEF_REQUIRED');
    const on = { FLOW_SOURCING_V1_ENABLED: 'true', FLOW_JOB_BRIEF_ENABLED: 'true' };
    expect(sourcingEnabled(on)).toBe(true);
    expect(() => sourcingEnabled(on, true)).toThrow('WEB_ONLY');
    for (const value of ['', '1', 'TRUE', ' true']) {
      expect(() => sourcingEnabled({ FLOW_SOURCING_V1_ENABLED: value })).toThrow('INVALID_CONFIGURATION');
    }
  });
  it('C1 accepts fixed reasons without inferring a motive and refuses all free text', () => {
    expect(sourcingDecisionSchema.parse(decision).reasonCode).toBeUndefined();
    expect(sourcingDecisionSchema.parse({ ...decision, reasonCode: 'skills_gap', criterionId: id }).reasonCode).toBe('skills_gap');
    for (const patch of [{ note: 'anything' }, { reason: 'anything' }, { reasonCode: 'culture_fit' }, { actorId: 1 }, { criterionId: id }]) {
      expect(sourcingDecisionSchema.safeParse({ ...decision, ...patch }).success).toBe(false);
    }
    expect(sourcingDecisionSchema.safeParse({ ...decision, action: 'clear', reasonCode: 'other' }).success).toBe(false);
    expect(sourcingDecisionSchema.safeParse({ ...decision, action: 'clear' }).success).toBe(true);
    for (const action of ['hide', 'unhide', 'reject', 'converted']) {
      expect(sourcingDecisionSchema.safeParse({ ...decision, action }).success).toBe(false);
    }
  });
  it('never accepts arbitrary payer, force or refresh on admission', () => {
    const request = { requestId: id, expectedRevision: 0, briefVersionId: id, materialHash: hash,
      artifactId: id, expectedPayerSlotId: id, expectedWindowStart: '2026-10-01T00:00:00.000Z', quoteToken:'signed-quote' };
    expect(sourcingAdmissionSchema.safeParse(request).success).toBe(true);
    for (const patch of [{ force: true }, { refresh: true }, { payerUserId: 7 }, { expectedRevision: -1 }]) {
      expect(sourcingAdmissionSchema.safeParse({ ...request, ...patch }).success).toBe(false);
    }
  });
  it('C2 distinguishes a deliberate preparation retry from a pool refresh', () => {
    expect(sourcingPreviewRequestSchema.safeParse({ action: 'retry_preparation', requestId: id, briefVersionId: id }).success).toBe(true);
    expect(sourcingPreviewRequestSchema.safeParse({ action: 'refresh', requestId: id, artifactId: id }).success).toBe(true);
    expect(sourcingPreviewRequestSchema.safeParse({ action: 'retry_preparation', requestId: id, briefVersionId: id, force: true }).success).toBe(false);
  });
  it('uses canonical key order and refuses oversized wire bodies', () => {
    expect(sourcingHash({ b: 2, a: 1 })).toBe(sourcingHash({ a: 1, b: 2 }));
    expect(() => parseSourcingBody(sourcingDecisionSchema, { ...decision, note: 'x'.repeat(131072) })).toThrow('BODY_TOO_LARGE');
  });
});

describe('UTC subscription anniversary windows', () => {
  it.each([
    ['2026-01-31T12:30:01.123Z', '2026-02-28T12:30:01.122Z', '2026-01-31T12:30:01.123Z', '2026-02-28T12:30:01.123Z'],
    ['2026-01-31T12:30:01.123Z', '2026-02-28T12:30:01.123Z', '2026-02-28T12:30:01.123Z', '2026-03-31T12:30:01.123Z'],
    ['2024-02-29T00:00:00.000Z', '2025-02-28T00:00:00.000Z', '2025-02-28T00:00:00.000Z', '2025-03-29T00:00:00.000Z'],
    ['2025-12-31T00:00:00.000Z', '2026-01-30T23:59:59.999Z', '2025-12-31T00:00:00.000Z', '2026-01-31T00:00:00.000Z'],
  ])('clamps from original anchor %s at %s', (anchor, now, start, end) => {
    const window = sourcingMonthlyWindow(new Date(anchor), new Date(now));
    expect(window.start.toISOString()).toBe(start);
    expect(window.end.toISOString()).toBe(end);
  });
  it('refuses invalid dates and times before entitlement began', () => {
    expect(() => sourcingMonthlyWindow(new Date('bad'), new Date())).toThrow('INVALID_WINDOW');
    expect(() => sourcingMonthlyWindow(new Date('2026-10-01'), new Date('2026-09-30'))).toThrow('INVALID_WINDOW');
  });
});
