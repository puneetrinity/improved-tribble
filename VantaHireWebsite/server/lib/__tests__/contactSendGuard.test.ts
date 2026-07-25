import { describe, expect, it, vi } from 'vitest';
import { deliverWithRevalidatedContact } from '../contactSendGuard';

const input = {
  candidateId: 41,
  organizationId: 1,
  jobId: 42,
  signalTenantId: 'org_1',
  signalCandidateId: 'candidate-41',
  externalJobId: 'vanta:jobs:42',
  attempts: 1,
};

describe('contact send guard', () => {
  it('never invokes delivery after Signal reports platform suppression', async () => {
    const deliver = vi.fn();
    const result = await deliverWithRevalidatedContact(input, {
      revalidate: async () => ({
        persisted: true,
        state: 'suppressed',
        emails: ['suppressed-stale@example.com'],
        errorCode: null,
      }),
      deliver,
    });

    expect(result.status).toBe('skipped');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('never invokes delivery while revalidation is still pending', async () => {
    const deliver = vi.fn();
    const result = await deliverWithRevalidatedContact(input, {
      revalidate: async () => ({
        persisted: true,
        state: 'pending',
        emails: ['pending-stale@example.com'],
        errorCode: 'signal_pending',
      }),
      deliver,
    });

    expect(result.status).toBe('skipped');
    expect(deliver).not.toHaveBeenCalled();
  });

  it('delivers only the freshly revalidated primary email', async () => {
    const deliver = vi.fn(async () => 'provider-message-id');
    const result = await deliverWithRevalidatedContact(input, {
      revalidate: async () => ({
        persisted: true,
        state: 'found',
        emails: ['fresh@example.com', 'alternate@example.com'],
        errorCode: null,
      }),
      deliver,
    });

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith('fresh@example.com');
    expect(result).toMatchObject({
      status: 'sent',
      email: 'fresh@example.com',
      value: 'provider-message-id',
    });
  });

  it('does not deliver if the authorized shortlisted row changed before persistence', async () => {
    const deliver = vi.fn();
    const result = await deliverWithRevalidatedContact(input, {
      revalidate: async () => ({
        persisted: false,
        state: 'found',
        emails: ['stale@example.com'],
        errorCode: null,
      }),
      deliver,
    });

    expect(result.status).toBe('skipped');
    expect(deliver).not.toHaveBeenCalled();
  });
});
