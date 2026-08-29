import { describe, expect, it, vi } from 'vitest';
import {
  INGEST_OCR_CALL_TIMEOUT_MS,
  INGEST_OCR_MAX_INPUT_BYTES,
  INGEST_OCR_MAX_PAGES,
  INGEST_OCR_MAX_PAGES_PER_REQUEST,
  INGEST_OCR_MAX_RESPONSE_BYTES,
  INGEST_OCR_TOTAL_TIMEOUT_MS,
  createGoogleVisionIngestOcrClientForTest,
} from '../googleVisionIngestOcrClient';

const pdf = Buffer.from('%PDF-1.7\nsynthetic image-only fixture');

function visionResponse(pages: number[], textPrefix = 'page') {
  return new Response(JSON.stringify({
    responses: [{
      responses: pages.map((page) => ({
        fullTextAnnotation: { text: `${textPrefix}-${page}` },
      })),
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function clientFor(input: {
  pageCount?: number;
  getAccessToken?: (timeoutMs: number) => Promise<string>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  totalTimeoutMs?: number;
  callTimeoutMs?: number;
}) {
  return createGoogleVisionIngestOcrClientForTest({
    countPages: async () => input.pageCount ?? 1,
    getAccessToken: input.getAccessToken ?? (async () => 'test-token'),
    fetchImpl: input.fetchImpl ?? (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return visionResponse(request.requests[0].pages);
    }) as typeof fetch,
    now: input.now,
  }, {
    totalTimeoutMs: input.totalTimeoutMs,
    callTimeoutMs: input.callTimeoutMs,
  });
}

describe('bounded ordinary-ingest Vision client', () => {
  it('freezes all production limits', () => {
    expect(INGEST_OCR_TOTAL_TIMEOUT_MS).toBe(20_000);
    expect(INGEST_OCR_CALL_TIMEOUT_MS).toBe(10_000);
    expect(INGEST_OCR_MAX_INPUT_BYTES).toBe(5 * 1024 * 1024);
    expect(INGEST_OCR_MAX_RESPONSE_BYTES).toBe(25 * 1024 * 1024);
    expect(INGEST_OCR_MAX_PAGES).toBe(10);
    expect(INGEST_OCR_MAX_PAGES_PER_REQUEST).toBe(5);
  });

  it.each([1, 3, 5])('uses one token and one exact inline request for a %s-page PDF', async (pageCount) => {
    const auth = vi.fn(async () => 'test-token');
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ url: String(url), init: init!, body });
      return visionResponse(body.requests[0].pages);
    }) as unknown as typeof fetch;
    const result = await clientFor({ pageCount, getAccessToken: auth, fetchImpl })(pdf);

    expect(result).toEqual({
      success: true,
      text: Array.from({ length: pageCount }, (_, index) => `page-${index + 1}`).join('\n\n'),
      providerCalls: 2,
    });
    expect(auth).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://vision.googleapis.com/v1/files:annotate');
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].body.requests[0]).toMatchObject({
      inputConfig: { content: pdf.toString('base64'), mimeType: 'application/pdf' },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      pages: Array.from({ length: pageCount }, (_, index) => index + 1),
    });
    expect(JSON.stringify(calls[0].body)).not.toContain('gcsSource');
    expect(JSON.stringify(calls[0].body)).not.toContain('gcsDestination');
  });

  it.each([6, 8, 10])('splits %s pages into deterministic requests of at most five pages', async (pageCount) => {
    const batches: number[][] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const pages = JSON.parse(String(init?.body)).requests[0].pages as number[];
      batches.push(pages);
      return visionResponse(pages);
    }) as unknown as typeof fetch;
    const result = await clientFor({ pageCount, fetchImpl })(pdf);
    expect(result.success).toBe(true);
    expect(result.providerCalls).toBe(3);
    expect(batches).toEqual([
      [1, 2, 3, 4, 5],
      Array.from({ length: pageCount - 5 }, (_, index) => index + 6),
    ]);
  });

  it.each([0, -1, 1.5])('refuses invalid page count %s before auth/provider', async (pageCount) => {
    const auth = vi.fn(async () => 'token');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await clientFor({ pageCount, getAccessToken: auth, fetchImpl })(pdf);
    expect(result).toMatchObject({ success: false, providerCalls: 0, reasonCode: 'OCR_PAGE_COUNT_REFUSED' });
    expect(auth).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses more than ten pages before auth/provider', async () => {
    const auth = vi.fn(async () => 'token');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await clientFor({ pageCount: 11, getAccessToken: auth, fetchImpl })(pdf);
    expect(result).toMatchObject({ success: false, providerCalls: 0, reasonCode: 'OCR_PAGE_CEILING_REFUSED' });
    expect(auth).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a non-PDF or oversized input before page/auth/provider work', async () => {
    const countPages = vi.fn(async () => 1);
    const client = createGoogleVisionIngestOcrClientForTest({
      countPages,
      getAccessToken: vi.fn(async () => 'token'),
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(await client(Buffer.from('not a pdf'))).toMatchObject({
      success: false,
      providerCalls: 0,
      reasonCode: 'OCR_PAGE_COUNT_REFUSED',
    });
    expect(await client(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(INGEST_OCR_MAX_INPUT_BYTES)]))).toMatchObject({
      success: false,
      providerCalls: 0,
      reasonCode: 'OCR_PAGE_COUNT_REFUSED',
    });
    expect(countPages).not.toHaveBeenCalled();
  });

  it('bounds page inspection, auth, and fetch waits with constant timeout outcomes', async () => {
    const never = new Promise<never>(() => {});
    const pageTimeout = createGoogleVisionIngestOcrClientForTest({
      countPages: async () => never,
      getAccessToken: async () => 'token',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    }, { totalTimeoutMs: 30, callTimeoutMs: 10 });
    expect(await pageTimeout(pdf)).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 0 });

    const authTimeout = clientFor({
      pageCount: 1,
      getAccessToken: async () => never,
      totalTimeoutMs: 30,
      callTimeoutMs: 10,
    });
    expect(await authTimeout(pdf)).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 1 });

    const fetchTimeout = clientFor({
      pageCount: 1,
      fetchImpl: vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('secret provider timeout body')));
      })) as unknown as typeof fetch,
      totalTimeoutMs: 30,
      callTimeoutMs: 10,
    });
    expect(await fetchTimeout(pdf)).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 2 });

    const fetchIgnoringAbort = clientFor({
      pageCount: 1,
      fetchImpl: vi.fn(async () => never) as unknown as typeof fetch,
      totalTimeoutMs: 30,
      callTimeoutMs: 10,
    });
    expect(await fetchIgnoringAbort(pdf)).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 2 });
  });

  it('clips the second annotate wait to the remaining total document deadline', async () => {
    const calls: number[][] = [];
    const never = new Promise<Response>(() => {});
    let nowMs = 1_000;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const pages = JSON.parse(String(init?.body)).requests[0].pages as number[];
      calls.push(pages);
      if (calls.length === 1) {
        nowMs += 15;
        return visionResponse(pages);
      }
      return never;
    }) as unknown as typeof fetch;
    const startedAt = Date.now();
    const result = await clientFor({
      pageCount: 6,
      fetchImpl,
      now: () => nowMs,
      totalTimeoutMs: 25,
      callTimeoutMs: 20,
    })(pdf);
    expect(result).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 3 });
    expect(calls).toEqual([[1, 2, 3, 4, 5], [6]]);
    expect(Date.now() - startedAt).toBeLessThan(80);
  });

  it('bounds a stalled streamed response body after the response headers arrive', async () => {
    const stalledBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => {});
      },
    });
    const result = await clientFor({
      pageCount: 1,
      fetchImpl: vi.fn(async () => new Response(stalledBody, { status: 200 })) as unknown as typeof fetch,
      totalTimeoutMs: 30,
      callTimeoutMs: 10,
    })(pdf);
    expect(result).toMatchObject({ reasonCode: 'OCR_TIMEOUT', providerCalls: 2 });
  });

  it.each([
    ['redirect/non-2xx', new Response('', { status: 302 }), 'OCR_PROVIDER_REFUSED'],
    ['invalid JSON', new Response('{', { status: 200 }), 'OCR_OUTPUT_REFUSED'],
    ['malformed shape', new Response('{}', { status: 200 }), 'OCR_OUTPUT_REFUSED'],
    ['page error', new Response(JSON.stringify({ responses: [{ responses: [{ error: { message: 'secret' } }] }] }), { status: 200 }), 'OCR_PROVIDER_REFUSED'],
  ])('maps %s to a constant without raw provider text', async (_label, response, reasonCode) => {
    const result = await clientFor({
      fetchImpl: vi.fn(async () => response) as unknown as typeof fetch,
    })(pdf);
    expect(result).toMatchObject({ success: false, text: '', reasonCode });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('rejects declared and streamed oversized responses', async () => {
    const declared = await clientFor({
      fetchImpl: vi.fn(async () => new Response('{}', {
        status: 200,
        headers: { 'content-length': String(INGEST_OCR_MAX_RESPONSE_BYTES + 1) },
      })) as unknown as typeof fetch,
    })(pdf);
    expect(declared.reasonCode).toBe('OCR_OUTPUT_REFUSED');

    const stream = new ReadableStream({
      start(controller) {
        for (let index = 0; index < 26; index += 1) controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    });
    const streamed = await clientFor({
      fetchImpl: vi.fn(async () => new Response(stream, { status: 200 })) as unknown as typeof fetch,
    })(pdf);
    expect(streamed.reasonCode).toBe('OCR_OUTPUT_REFUSED');
  });

  it('does not emit tokens, provider bodies, or resume bytes to console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    try {
      const result = await clientFor({
        getAccessToken: async () => 'secret-token-canary',
        fetchImpl: vi.fn(async () => new Response('secret-provider-body', { status: 503 })) as unknown as typeof fetch,
      })(Buffer.from('%PDF-1.7 secret-resume-canary'));
      expect(result.reasonCode).toBe('OCR_PROVIDER_REFUSED');
      expect(JSON.stringify(result)).not.toMatch(/secret-(?:token|provider|resume)-canary/);
      expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
