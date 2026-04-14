import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './queryClient';
import { clearCsrfToken, getCsrfToken } from './csrf';

describe('apiRequest CSRF retry handling', () => {
  afterEach(() => {
    clearCsrfToken();
    vi.restoreAllMocks();
  });

  it('refreshes the CSRF token and retries the same request exactly once after a 403', async () => {
    let csrfFetches = 0;
    let requestAttempts = 0;
    const sentTokens: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/csrf-token')) {
        csrfFetches += 1;
        return new Response(
          JSON.stringify({ token: csrfFetches === 1 ? 'stale-token' : 'fresh-token' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url === '/api/test-csrf-retry') {
        requestAttempts += 1;
        sentTokens.push(new Headers(init?.headers).get('x-csrf-token') ?? '');

        return requestAttempts === 1
          ? new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    await getCsrfToken();

    const response = await apiRequest('POST', '/api/test-csrf-retry', { hello: 'world' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(csrfFetches).toBe(2);
    expect(requestAttempts).toBe(2);
    expect(sentTokens).toEqual(['stale-token', 'fresh-token']);
  });

  it('stops after one retry when the refreshed CSRF token still gets a 403', async () => {
    let csrfFetches = 0;
    let requestAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes('/api/csrf-token')) {
        csrfFetches += 1;
        return new Response(
          JSON.stringify({ token: csrfFetches === 1 ? 'stale-token' : 'still-bad-token' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url === '/api/test-csrf-still-forbidden') {
        requestAttempts += 1;
        return new Response(JSON.stringify({ error: 'Still forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    await getCsrfToken();

    await expect(
      apiRequest('POST', '/api/test-csrf-still-forbidden', { hello: 'world' }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(csrfFetches).toBe(2);
    expect(requestAttempts).toBe(2);
  });
});
