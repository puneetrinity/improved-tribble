import { afterEach, describe, expect, it, vi } from 'vitest';

const { signServiceJwt } = vi.hoisted(() => ({
  signServiceJwt: vi.fn(async () => 'signed-token'),
}));

vi.mock('../services/jwt-signer', () => ({ signServiceJwt }));

import {
  findContact,
  normalizeContactResolutionResponse,
} from '../services/signal-client';

describe('Signal contact response compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete process.env.SIGNAL_BASE_URL;
  });

  it('derives terminal state from the legacy response shape', () => {
    expect(normalizeContactResolutionResponse({
      success: true,
      emails: ['one@example.com'],
    }, 200)).toEqual({
      success: true,
      state: 'found',
      emails: ['one@example.com'],
    });

    expect(normalizeContactResolutionResponse({
      success: true,
      emails: [],
    }, 200)).toEqual({
      success: true,
      state: 'not_found',
      emails: [],
    });
  });

  it('treats HTTP 202 as retryable even if a stale server omits pending state', () => {
    expect(normalizeContactResolutionResponse({
      success: true,
      emails: [],
    }, 202)).toEqual({
      success: true,
      state: 'pending',
      emails: [],
    });
  });

  it('preserves suppression without exposing an email', () => {
    expect(normalizeContactResolutionResponse({
      success: true,
      state: 'suppressed',
      emails: [],
    }, 200)).toEqual({
      success: true,
      state: 'suppressed',
      emails: [],
    });
  });

  it('uses the dedicated contact scope for Flow-to-Signal resolution', async () => {
    process.env.SIGNAL_BASE_URL = 'https://signal.example';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true,
      state: 'pending',
      emails: [],
    }), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(findContact('org_1', 'candidate-1', 'vanta:jobs:42')).resolves.toMatchObject({
      state: 'pending',
    });
    expect(signServiceJwt).toHaveBeenCalledWith('signal', expect.objectContaining({
      tenantId: 'org_1',
      scopes: 'contact:write',
    }));
    expect(fetch).toHaveBeenCalledWith(
      'https://signal.example/api/v3/candidates/candidate-1/find-contact',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          trigger: 'shortlist',
          jobId: 'vanta:jobs:42',
        }),
      }),
    );
  });
});
