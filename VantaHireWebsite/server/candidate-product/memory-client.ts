import { signServiceJwt } from '../lib/services/jwt-signer';
import { parseStrictJson, parseWire, receiptSchema } from './contracts';

export type FoundationDeliveryCode = 'timeout' | 'network' | 'remote_retry'
  | 'remote_conflict' | 'remote_denied' | 'invalid_response';
export class FoundationDeliveryError extends Error {
  constructor(public readonly code: FoundationDeliveryCode, public readonly retryAfterSeconds?: number) {
    super(code);
  }
}

export function foundationMemoryOrigin(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const url = new URL(env.ACTIVEKG_BASE_URL ?? '');
    const localTest = env.NODE_ENV === 'test' && env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST === '1'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(localTest && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
    return url.origin;
  } catch { throw new FoundationDeliveryError('remote_denied'); }
}

/** One attempt only. The durable outbox owns all retries, not this transport. */
export async function deliverFoundation(raw: string, expectedHash: string, timeoutMs: number,
  dependencies: { fetch?: typeof fetch; sign?: typeof signServiceJwt; env?: NodeJS.ProcessEnv } = {}) {
  let command: ReturnType<typeof parseWire>;
  try {
    command = parseWire(raw);
    if (command.hash !== expectedHash || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw Error();
  } catch { throw new FoundationDeliveryError('invalid_response'); }
  const origin = foundationMemoryOrigin(dependencies.env);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Covers signing, headers and streaming body; no wait can outlive the attempt budget.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new FoundationDeliveryError('timeout'));
    }, timeoutMs);
  });
  const operation = async () => {
    const token = await (dependencies.sign ?? signServiceJwt)('activekg', {
      tenantId: `candidate_${command.value.subjectId}`, scopes: 'candidate-profile:foundation-write',
      actorType: 'service', requestId: command.value.commandId, lifetimeSeconds: 60,
    });
    if (controller.signal.aborted) throw new FoundationDeliveryError('timeout');
    const response = await (dependencies.fetch ?? fetch)(`${origin}/candidate-profiles/foundation/commands`, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
        'X-Candidate-Command-SHA256': expectedHash },
      body: raw,
    });
    if (response.status !== 200 && response.status !== 201) {
      // Error bodies are neither trusted nor logged. Release their transport resources.
      void response.body?.cancel().catch(() => {});
      if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        const retry = response.headers.get('retry-after');
        let seconds: number | undefined;
        if (retry) {
          if (/^\d+$/.test(retry)) seconds = Number(retry);
          else { const at = Date.parse(retry); if (Number.isFinite(at)) seconds = Math.max(0, Math.ceil((at-Date.now())/1000)); }
          // Values beyond the durable maximum must hold, never cause a rapid retry.
          if (seconds !== undefined) seconds = Math.min(seconds, 86401);
        }
        throw new FoundationDeliveryError('remote_retry', seconds);
      }
      throw new FoundationDeliveryError(response.status === 409 ? 'remote_conflict' : 'remote_denied');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new FoundationDeliveryError('invalid_response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', abort, { once: true });
    try {
      for (;;) {
        if (controller.signal.aborted) throw new FoundationDeliveryError('timeout');
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { abort(); throw new FoundationDeliveryError('invalid_response'); }
        chunks.push(value);
      }
    } finally {
      controller.signal.removeEventListener('abort', abort);
      reader.releaseLock();
    }
    let receipt;
    try {
      receipt = receiptSchema.parse(parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    } catch { throw new FoundationDeliveryError('invalid_response'); }
    if (receipt.commandId !== command.value.commandId || receipt.subjectId !== command.value.subjectId
      || receipt.bindingId !== command.value.bindingId || receipt.sequence !== command.value.sequence
      || receipt.wireSha256 !== expectedHash) throw new FoundationDeliveryError('invalid_response');
    return receipt;
  };
  try { return await Promise.race([operation(), deadline]); }
  catch (error) {
    if (error instanceof FoundationDeliveryError) throw error;
    throw new FoundationDeliveryError(controller.signal.aborted ? 'timeout' : 'network');
  } finally { clearTimeout(timer); }
}
