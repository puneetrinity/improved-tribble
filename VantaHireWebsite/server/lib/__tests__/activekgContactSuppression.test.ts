import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signServiceJwt = vi.hoisted(() => vi.fn(async () => 'signed-token'));

vi.mock('../services/jwt-signer', () => ({ signServiceJwt }));

import { suppressContactEvidence } from '../services/activekg-client';

describe('Memory contact suppression client', () => {
  beforeEach(() => {
    process.env.ACTIVEKG_BASE_URL = 'https://memory.example.test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      suppressed: true,
      reason: 'complaint',
      evidence: 'absent',
      scope: 'person',
      global_candidate_id: 'global-candidate-1',
      idempotent: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses the dedicated authority and sends the explicit identity anchor', async () => {
    await expect(suppressContactEvidence(
      'org_7',
      {
        emailHash: 'b'.repeat(64),
        reason: 'complaint',
        providerEventId: 'a'.repeat(64),
        signalCandidateId: 'signal-candidate-7',
      },
      'brevo:event-7',
    )).resolves.toMatchObject({ scope: 'person' });

    expect(signServiceJwt).toHaveBeenCalledWith('activekg', {
      tenantId: 'org_7',
      scopes: 'contact:suppress',
      requestId: 'brevo:event-7',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://memory.example.test/contact-evidence/suppress',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email_hash: 'b'.repeat(64),
          reason: 'complaint',
          provider_event_id: 'a'.repeat(64),
          signal_candidate_id: 'signal-candidate-7',
        }),
      }),
    );
  });

  it('fails closed on a malformed Memory acknowledgement', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      suppressed: true,
      scope: 'address',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    await expect(suppressContactEvidence(
      'org_7',
      {
        emailHash: 'b'.repeat(64),
        reason: 'complaint',
        providerEventId: 'a'.repeat(64),
        signalCandidateId: 'signal-candidate-7',
      },
    )).rejects.toMatchObject({ statusCode: 502 });
  });
});
