// CSRF token management for client-side requests
const CSRF_TOKEN_ENDPOINT = '/api/csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let cachedToken: string | null = null;
let csrfTokenPromise: Promise<string> | null = null;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function getRequestMethod(init?: RequestInit): string {
  return (init?.method || 'GET').toUpperCase();
}

function isCsrfTokenRequest(input: RequestInfo | URL): boolean {
  return getRequestUrl(input).includes(CSRF_TOKEN_ENDPOINT);
}

function withHeader(headers: HeadersInit | undefined, name: string, value: string): Headers {
  const nextHeaders = new Headers(headers);
  nextHeaders.set(name, value);
  return nextHeaders;
}

function buildRequestInit(
  init: RequestInit,
  credentials: RequestCredentials,
  headers?: HeadersInit,
): RequestInit {
  return {
    ...init,
    credentials,
    ...(headers ? { headers } : {}),
  };
}

async function fetchAndCacheCsrfToken(): Promise<string> {
  if (!csrfTokenPromise) {
    csrfTokenPromise = (async () => {
      const response = await fetch(CSRF_TOKEN_ENDPOINT, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch CSRF token: ${response.status}`);
      }

      const data = await response.json();
      const token = data.token;
      if (typeof token !== 'string') {
        throw new Error('Invalid CSRF token received from server');
      }

      cachedToken = token;
      return token;
    })().finally(() => {
      csrfTokenPromise = null;
    });
  }

  return csrfTokenPromise;
}

/**
 * Fetches and caches the CSRF token from the server
 * Token is cached in memory to avoid repeated requests
 */
export async function getCsrfToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  if (options.forceRefresh) {
    clearCsrfToken();
  }

  // Return cached token if available
  if (cachedToken) {
    return cachedToken;
  }

  try {
    return await fetchAndCacheCsrfToken();
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
    throw error;
  }
}

/**
 * Clears the cached CSRF token
 * Call this on authentication changes or CSRF errors
 */
export function clearCsrfToken(): void {
  cachedToken = null;
}

interface FetchWithCsrfOptions {
  retryOn403?: boolean;
  retryCount?: number;
  requireCsrfToken?: boolean;
}

export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchWithCsrfOptions = {},
): Promise<Response> {
  const method = getRequestMethod(init);
  const requireCsrfToken = options.requireCsrfToken ?? MUTATING_METHODS.has(method);
  const retryOn403 = options.retryOn403 ?? requireCsrfToken;
  const credentials = init.credentials ?? 'include';

  let headers = init.headers;
  if (requireCsrfToken) {
    const token = await getCsrfToken();
    headers = withHeader(headers, CSRF_HEADER_NAME, token);
  }

  const response = await fetch(input, buildRequestInit(init, credentials, headers));

  if (
    response.status === 403 &&
    retryOn403 &&
    (options.retryCount ?? 0) === 0 &&
    !isCsrfTokenRequest(input)
  ) {
    clearCsrfToken();

    const retriedHeaders = requireCsrfToken
      ? withHeader(init.headers, CSRF_HEADER_NAME, await getCsrfToken({ forceRefresh: true }))
      : init.headers;

    return fetchWithCsrf(
      input,
      buildRequestInit(init, credentials, retriedHeaders),
      {
        ...options,
        retryCount: 1,
      },
    );
  }

  return response;
}

/**
 * Adds CSRF token to request headers
 * Use this for JSON requests
 */
export async function addCsrfHeader(headers: HeadersInit = {}): Promise<HeadersInit> {
  const token = await getCsrfToken();
  return {
    ...headers,
    [CSRF_HEADER_NAME]: token,
  };
}

/**
 * Adds CSRF token to FormData
 * Use this for multipart/form-data requests
 */
export async function addCsrfToFormData(formData: FormData): Promise<FormData> {
  const token = await getCsrfToken();
  formData.append('_csrf', token);
  return formData;
}
