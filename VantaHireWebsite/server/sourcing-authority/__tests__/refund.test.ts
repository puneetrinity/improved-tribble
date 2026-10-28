import { describe, expect, it, vi } from 'vitest';
import { drainOpsNotifications, refundNoResultSearch, sendUnresolvedRefundAlert } from '../refund';
import { sourcingRefundPolicy } from '../contracts';

const admission = '00000000-0000-4000-8000-000000000001';
const on = { FLOW_SOURCING_REFUND_SYSTEM_FAILURE: 'true', FLOW_SOURCING_REFUND_ZERO_RESULTS: 'true' };

describe('no-result search refunds', () => {
  it('keeps both parts off unless explicitly enabled, and refuses invalid values', () => {
    expect(sourcingRefundPolicy({})).toEqual({ systemFailure: false, zeroResults: false });
    expect(sourcingRefundPolicy({ FLOW_SOURCING_REFUND_SYSTEM_FAILURE: 'true' })).toEqual({ systemFailure: true, zeroResults: false });
    expect(() => sourcingRefundPolicy({ FLOW_SOURCING_REFUND_ZERO_RESULTS: 'yes' })).toThrow('SOURCING_INVALID_CONFIGURATION');
  });
  it('calls the database only when the matching part is enabled', async () => {
    const call = vi.fn().mockResolvedValue({ refunded: true });
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' }, { call, env: {} })).toEqual({ attempted: false, retry: false });
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'zero_results' },
      { call, env: { FLOW_SOURCING_REFUND_SYSTEM_FAILURE: 'true' } })).toEqual({ attempted: false, retry: false });
    expect(call).not.toHaveBeenCalled();
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' }, { call, env: on }))
      .toEqual({ attempted: true, retry: false, result: { refunded: true } });
    expect(call).toHaveBeenCalledWith(1, admission, 'system_failure');
  });
  it('skips legacy runs without an admission', async () => {
    const call = vi.fn();
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: null, reason: 'system_failure' }, { call, env: on })).toEqual({ attempted: false, retry: false });
    expect(call).not.toHaveBeenCalled();
  });
  it('never throws; reports only a safe error code', async () => {
    const call = vi.fn().mockRejectedValue(Object.assign(new Error('raw detail that must not leak'), { code: 'SOURCING_UNAVAILABLE' }));
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' }, { call, env: on }))
      .toEqual({ attempted: true, retry: true, errorCode: 'SOURCING_UNAVAILABLE' });
    const odd = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'not a safe code!' }));
    expect((await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' }, { call: odd, env: on })).errorCode)
      .toBe('SOURCING_REFUND_FAILED');
  });
  it('retries only an unknown outcome, never a definitive one', async () => {
    for (const result of [{ refunded: true, replayed: false, target: 'original_window' }, { refunded: true, replayed: true },
      { refunded: false, code: 'SOURCING_REFUND_DELIVERED' }, { refunded: false, code: 'SOURCING_REFUND_NOT_TERMINAL' }, null]) {
      const out = await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' },
        { call: vi.fn().mockResolvedValue(result), env: on });
      expect(out.retry).toBe(false);
    }
    const timeout = vi.fn().mockRejectedValue(Object.assign(new Error('lock'), { code: '55P03' }));
    expect(await refundNoResultSearch({ organizationId: 1, admissionId: admission, reason: 'system_failure' }, { call: timeout, env: on }))
      .toEqual({ attempted: true, retry: true, errorCode: '55P03' });
  });
  it('sends the operator alert only to a configured valid address', async () => {
    const alert = { organizationId: 1, admissionId: admission, reason: 'system_failure' as const };
    expect(await sendUnresolvedRefundAlert(alert, {})).toBe(false);
    expect(await sendUnresolvedRefundAlert(alert, { FLOW_OPS_ALERT_EMAIL: 'not an email' })).toBe(false);
  });
  it('drains notifications with retries and settles each claim under its own lease', async () => {
    const env = { FLOW_OPS_ALERT_EMAIL: 'puneet@ealana.com' };
    const queue = [
      { id: 'n1', kind: 'refund_unusable' as const, organizationId: 7, subjectId: admission, reason: 'zero_results' as const, attempt: 1 },
      { id: 'n2', kind: 'refund_unusable' as const, organizationId: 8, subjectId: admission, reason: 'system_failure' as const, attempt: 3 },
    ];
    const claim = vi.fn(async () => queue.shift() ?? null);
    const finish = vi.fn(async () => true);
    const send = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('smtp down'));
    expect(await drainOpsNotifications({ claim, finish, send, env })).toEqual({ sent: 1, failed: 1 });
    const leases = claim.mock.calls.map((c) => c[0]);
    expect(finish).toHaveBeenNthCalledWith(1, 'n1', leases[0], true, null);
    expect(finish).toHaveBeenNthCalledWith(2, 'n2', leases[1], false, 'SEND_FAILED');
    expect(send).toHaveBeenCalledWith({ organizationId: 7, admissionId: admission, reason: 'zero_results' });
  });
  it('spends no attempt while no recipient is configured', async () => {
    const claim = vi.fn();
    expect(await drainOpsNotifications({ claim, finish: vi.fn(), send: vi.fn(), env: {} })).toEqual({ sent: 0, failed: 0 });
    expect(claim).not.toHaveBeenCalled();
  });
});

import { noResultRefundReason } from '../refund';
import { noResultRefundOffered } from '../contracts';

describe('Part B trigger', () => {
  it('maps terminal callbacks to the right refund, or none', () => {
    expect(noResultRefundReason('failed', 'failed', 0)).toBe('system_failure');
    expect(noResultRefundReason('complete', 'completed', 0)).toBe('zero_results');
    // partial results, any delivered candidate, or Flow's own fetch failure: no refund
    expect(noResultRefundReason('partial', 'completed', 0)).toBeNull();
    expect(noResultRefundReason('complete', 'completed', 3)).toBeNull();
    expect(noResultRefundReason('complete', 'failed', 0)).toBeNull();
    expect(noResultRefundReason('partial', 'failed', 0)).toBeNull();
  });
  it('offers "no candidates, no search charged" only while both switches are on', () => {
    expect(noResultRefundOffered({ FLOW_SOURCING_REFUND_SYSTEM_FAILURE: 'true', FLOW_SOURCING_REFUND_ZERO_RESULTS: 'true' })).toBe(true);
    expect(noResultRefundOffered({ FLOW_SOURCING_REFUND_SYSTEM_FAILURE: 'true' })).toBe(false);
    expect(noResultRefundOffered({ FLOW_SOURCING_REFUND_ZERO_RESULTS: 'true' })).toBe(false);
    expect(noResultRefundOffered({})).toBe(false);
    expect(noResultRefundOffered({ FLOW_SOURCING_REFUND_ZERO_RESULTS: 'yes' })).toBe(false);
  });
});
