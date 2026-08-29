import { GoogleAuth } from 'google-auth-library';

export const INGEST_OCR_TOTAL_TIMEOUT_MS = 20_000;
export const INGEST_OCR_CALL_TIMEOUT_MS = 10_000;
export const INGEST_OCR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const INGEST_OCR_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
export const INGEST_OCR_MAX_PAGES = 10;
export const INGEST_OCR_MAX_PAGES_PER_REQUEST = 5;

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/files:annotate';

export type GoogleVisionIngestOcrReasonCode =
  | 'OCR_DISABLED'
  | 'OCR_NOT_CONFIGURED'
  | 'OCR_PAGE_COUNT_REFUSED'
  | 'OCR_PAGE_CEILING_REFUSED'
  | 'OCR_AUTH_REFUSED'
  | 'OCR_TIMEOUT'
  | 'OCR_PROVIDER_REFUSED'
  | 'OCR_OUTPUT_REFUSED';

export type GoogleVisionIngestOcrResult = {
  success: boolean;
  text: string;
  providerCalls: number;
  reasonCode?: GoogleVisionIngestOcrReasonCode;
};

type FetchLike = typeof fetch;

type ClientDependencies = {
  countPages: (buffer: Buffer, timeoutMs: number) => Promise<number>;
  getAccessToken: (timeoutMs: number) => Promise<string>;
  fetchImpl: FetchLike;
  now?: () => number;
};

type ClientLimits = {
  totalTimeoutMs: number;
  callTimeoutMs: number;
};

function parseServiceAccountKey(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === 'string') {
      const nested = JSON.parse(parsed);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
      }
    }
  } catch {
    // Continue to the bounded normalized representation used by existing GCS configuration.
  }
  const normalized = raw.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OCR_AUTH_REFUSED');
  }
  return parsed as Record<string, unknown>;
}

function remainingMilliseconds(deadline: number, ceiling: number, now = Date.now()): number {
  return Math.max(0, Math.min(ceiling, deadline - now));
}

async function boundedPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('OCR_TIMEOUT');
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OCR_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function countPdfPages(buffer: Buffer, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let loadingTask: any;
  let document: any;
  try {
    const pdfjs: any = await boundedPromise(
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      remainingMilliseconds(deadline, timeoutMs),
    );
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
    });
    document = await boundedPromise(
      loadingTask.promise,
      remainingMilliseconds(deadline, timeoutMs),
    );
    return Number(document.numPages);
  } catch (error) {
    if (error instanceof Error && error.message === 'OCR_TIMEOUT') throw error;
    throw new Error('OCR_PAGE_COUNT_REFUSED');
  } finally {
    try { void Promise.resolve(document?.destroy()).catch(() => {}); } catch {}
    try { void Promise.resolve(loadingTask?.destroy()).catch(() => {}); } catch {}
  }
}

function pageBatches(pageCount: number): number[][] {
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1);
  const batches: number[][] = [];
  for (let index = 0; index < pages.length; index += INGEST_OCR_MAX_PAGES_PER_REQUEST) {
    batches.push(pages.slice(index, index + INGEST_OCR_MAX_PAGES_PER_REQUEST));
  }
  return batches;
}

async function readBoundedBody(
  response: Response,
  deadline: number,
  now: () => number,
): Promise<Buffer> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > INGEST_OCR_MAX_RESPONSE_BYTES) {
      throw new Error('OCR_OUTPUT_REFUSED');
    }
  }
  if (!response.body) throw new Error('OCR_OUTPUT_REFUSED');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await boundedPromise(
        reader.read(),
        remainingMilliseconds(deadline, INGEST_OCR_CALL_TIMEOUT_MS, now()),
      );
      if (done) break;
      total += value.byteLength;
      if (total > INGEST_OCR_MAX_RESPONSE_BYTES) throw new Error('OCR_OUTPUT_REFUSED');
      chunks.push(Buffer.from(value));
    }
  } finally {
    if (now() >= deadline) {
      try { void reader.cancel().catch(() => {}); } catch {}
    }
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, total);
}

function pageTexts(payload: unknown, expectedPages: number): string[] {
  if (!payload || typeof payload !== 'object') throw new Error('OCR_OUTPUT_REFUSED');
  const outer = (payload as { responses?: unknown }).responses;
  if (!Array.isArray(outer) || outer.length !== 1) throw new Error('OCR_OUTPUT_REFUSED');
  const file = outer[0];
  if (!file || typeof file !== 'object' || 'error' in file) throw new Error('OCR_PROVIDER_REFUSED');
  const pages = (file as { responses?: unknown }).responses;
  if (!Array.isArray(pages) || pages.length !== expectedPages) throw new Error('OCR_OUTPUT_REFUSED');
  return pages.map((page) => {
    if (!page || typeof page !== 'object') throw new Error('OCR_OUTPUT_REFUSED');
    if ('error' in page) throw new Error('OCR_PROVIDER_REFUSED');
    const annotation = (page as { fullTextAnnotation?: { text?: unknown } }).fullTextAnnotation;
    return typeof annotation?.text === 'string' ? annotation.text.trim() : '';
  });
}

function knownReason(error: unknown): GoogleVisionIngestOcrReasonCode {
  const message = error instanceof Error ? error.message : '';
  const allowed = new Set<GoogleVisionIngestOcrReasonCode>([
    'OCR_PAGE_COUNT_REFUSED',
    'OCR_PAGE_CEILING_REFUSED',
    'OCR_AUTH_REFUSED',
    'OCR_TIMEOUT',
    'OCR_PROVIDER_REFUSED',
    'OCR_OUTPUT_REFUSED',
  ]);
  return allowed.has(message as GoogleVisionIngestOcrReasonCode)
    ? message as GoogleVisionIngestOcrReasonCode
    : 'OCR_PROVIDER_REFUSED';
}

function createClient(dependencies: ClientDependencies, limits: ClientLimits) {
  return async (buffer: Buffer): Promise<GoogleVisionIngestOcrResult> => {
    const now = dependencies.now ?? Date.now;
    let providerCalls = 0;
    if (!Buffer.isBuffer(buffer)
        || buffer.length <= 0
        || buffer.length > INGEST_OCR_MAX_INPUT_BYTES
        || !buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from('%PDF-'))) {
      return { success: false, text: '', providerCalls, reasonCode: 'OCR_PAGE_COUNT_REFUSED' };
    }
    const deadline = now() + limits.totalTimeoutMs;
    try {
      const pageTimeoutMs = remainingMilliseconds(deadline, limits.callTimeoutMs, now());
      if (pageTimeoutMs <= 0) throw new Error('OCR_TIMEOUT');
      const pageCount = await boundedPromise(
        dependencies.countPages(buffer, pageTimeoutMs),
        pageTimeoutMs,
      );
      if (!Number.isSafeInteger(pageCount) || pageCount <= 0) throw new Error('OCR_PAGE_COUNT_REFUSED');
      if (pageCount > INGEST_OCR_MAX_PAGES) throw new Error('OCR_PAGE_CEILING_REFUSED');

      providerCalls += 1;
      const authTimeoutMs = remainingMilliseconds(deadline, limits.callTimeoutMs, now());
      if (authTimeoutMs <= 0) throw new Error('OCR_TIMEOUT');
      const accessToken = await boundedPromise(
        dependencies.getAccessToken(authTimeoutMs),
        authTimeoutMs,
      );
      if (!accessToken) throw new Error('OCR_AUTH_REFUSED');

      const textChunks: string[] = [];
      for (const pages of pageBatches(pageCount)) {
        const timeoutMs = remainingMilliseconds(deadline, limits.callTimeoutMs, now());
        if (timeoutMs <= 0) throw new Error('OCR_TIMEOUT');
        const callDeadline = now() + timeoutMs;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        providerCalls += 1;
        try {
          const response = await boundedPromise(
            dependencies.fetchImpl(VISION_ENDPOINT, {
              method: 'POST',
              redirect: 'error',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                requests: [{
                  inputConfig: {
                    content: buffer.toString('base64'),
                    mimeType: 'application/pdf',
                  },
                  features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
                  pages,
                }],
              }),
              signal: controller.signal,
            }),
            timeoutMs,
          );
          if (!response.ok) throw new Error('OCR_PROVIDER_REFUSED');
          const raw = await readBoundedBody(response, callDeadline, now);
          let payload: unknown;
          try {
            payload = JSON.parse(raw.toString('utf8'));
          } catch {
            throw new Error('OCR_OUTPUT_REFUSED');
          }
          textChunks.push(...pageTexts(payload, pages.length));
        } catch (error) {
          if (controller.signal.aborted) throw new Error('OCR_TIMEOUT');
          throw error;
        } finally {
          clearTimeout(timer);
        }
      }
      return {
        success: true,
        text: textChunks.filter(Boolean).join('\n\n').trim(),
        providerCalls,
      };
    } catch (error) {
      return { success: false, text: '', providerCalls, reasonCode: knownReason(error) };
    }
  };
}

export function createGoogleVisionIngestOcrClientForTest(
  dependencies: ClientDependencies,
  limits: Partial<ClientLimits> = {},
) {
  return createClient(dependencies, {
    totalTimeoutMs: limits.totalTimeoutMs ?? INGEST_OCR_TOTAL_TIMEOUT_MS,
    callTimeoutMs: limits.callTimeoutMs ?? INGEST_OCR_CALL_TIMEOUT_MS,
  });
}

export async function extractTextWithGoogleVisionIngestOcr(
  buffer: Buffer,
): Promise<GoogleVisionIngestOcrResult> {
  if (process.env.GOOGLE_VISION_OCR_ENABLED !== 'true') {
    return { success: false, text: '', providerCalls: 0, reasonCode: 'OCR_DISABLED' };
  }
  const rawCredentials = process.env.GCS_SERVICE_ACCOUNT_KEY;
  const projectId = process.env.GCS_PROJECT_ID;
  if (!rawCredentials || !projectId) {
    return { success: false, text: '', providerCalls: 0, reasonCode: 'OCR_NOT_CONFIGURED' };
  }
  let credentials: Record<string, unknown>;
  try {
    credentials = parseServiceAccountKey(rawCredentials);
  } catch {
    return { success: false, text: '', providerCalls: 0, reasonCode: 'OCR_AUTH_REFUSED' };
  }
  const auth = new GoogleAuth({
    credentials,
    projectId,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = createClient({
    countPages: countPdfPages,
    fetchImpl: fetch,
    getAccessToken: async (timeoutMs) => {
      try {
        const authClient = await boundedPromise(auth.getClient(), timeoutMs);
        const tokenResponse = await boundedPromise(authClient.getAccessToken(), timeoutMs);
        const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
        if (!token) throw new Error('OCR_AUTH_REFUSED');
        return token;
      } catch (error) {
        if (error instanceof Error && error.message === 'OCR_TIMEOUT') throw error;
        throw new Error('OCR_AUTH_REFUSED');
      }
    },
  }, {
    totalTimeoutMs: INGEST_OCR_TOTAL_TIMEOUT_MS,
    callTimeoutMs: INGEST_OCR_CALL_TIMEOUT_MS,
  });
  return client(buffer);
}
