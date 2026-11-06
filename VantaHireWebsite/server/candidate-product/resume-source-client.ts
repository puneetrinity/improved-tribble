import { createHash } from 'node:crypto';
import { z } from 'zod';
import { signServiceJwt } from '../lib/services/jwt-signer';
import { profileHash, profileRevision, profileUuid } from '../../shared/candidate-profile';
import { foundationMemoryOrigin } from './memory-client';
import { canonicalProfileJson, parseProfileJson } from './profile-contracts';

/** Frozen receiver bounds (LOCK resumeReceiver). */
export const RESUME_TRANSFER_MAX_BYTES = 2 * 1024 * 1024;
export const RESUME_TEXT_MAX_BYTES = 512 * 1024;
export const RESUME_RECEIPT_MAX_BYTES = 8192;
export const RESUME_TRANSFER_DEADLINE_MS = 10_000;
const RESUME_PATH = '/candidate-profiles/sources/resume';

/** Terminal: invalid_request, command_conflict, identity_conflict, candidate_privacy_restricted.
 * Retryable with the exact same stored command: memory_unavailable, delivery_outcome_unknown.
 * Never a provider failure; the caller must not rerun extraction or the model. */
export type ResumeTransferCode = 'invalid_request' | 'command_conflict' | 'identity_conflict'
  | 'candidate_privacy_restricted' | 'memory_unavailable' | 'delivery_outcome_unknown';
export class ResumeTransferError extends Error {
  constructor(public readonly code: ResumeTransferCode) { super(code); }
}

export interface StoredTransfer { canonical: string; sha256: string }

const transferIdentity = z.object({
  schemaVersion: z.literal(1), commandId: profileUuid, subjectId: profileUuid, bindingId: profileUuid,
  sourceId: profileUuid, sourceVersion: profileRevision, contentHash: profileHash, textHash: profileHash,
  consentRevision: profileRevision, text: z.string().min(1),
  proposal: z.object({ proposalId: profileUuid, proposalHash: profileHash, sourceKind: z.literal('resume'),
    sourceId: profileUuid, sourceVersion: profileRevision }).passthrough(),
}).passthrough();

export const resumeSourceReceiptSchema = z.object({
  schemaVersion: z.literal(1), commandId: profileUuid, subjectId: profileUuid, bindingId: profileUuid, commandHash: profileHash,
  sourceId: profileUuid, sourceVersion: profileRevision, proposalId: profileUuid, proposalHash: profileHash,
  outcome: z.enum(['stored', 'rejected']),
  reason: z.enum(['consent_changed', 'source_conflict', 'stale_edit', 'proposal_expired']).nullable(),
  canonicalProfileChanged: z.literal(false), publicationActive: z.literal(false),
}).strict().refine(v => (v.outcome === 'stored') === (v.reason === null));
export type ResumeSourceReceipt = z.infer<typeof resumeSourceReceiptSchema>;

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');

/** Re-proves the persisted command before any network work: exact canonical bytes,
 * hash, text hash and proposal hash. A drifted row is never sent. */
export function verifyStoredTransfer(stored: StoredTransfer) {
  try {
    if (typeof stored?.canonical !== 'string' || Buffer.byteLength(stored.canonical, 'utf8') > RESUME_TRANSFER_MAX_BYTES) throw Error();
    profileHash.parse(stored.sha256);
    if (sha(stored.canonical) !== stored.sha256) throw Error();
    const parsed = parseProfileJson(stored.canonical, RESUME_TRANSFER_MAX_BYTES);
    if (canonicalProfileJson(parsed) !== stored.canonical) throw Error();
    const v = transferIdentity.parse(parsed);
    if (Buffer.byteLength(v.text, 'utf8') > RESUME_TEXT_MAX_BYTES || sha(v.text) !== v.textHash) throw Error();
    if (v.proposal.sourceId !== v.sourceId || v.proposal.sourceVersion !== v.sourceVersion) throw Error();
    const { proposalHash, ...body } = v.proposal;
    if (sha(canonicalProfileJson(body)) !== proposalHash) throw Error();
    return v;
  } catch { throw new ResumeTransferError('invalid_request'); }
}

type Deps = { fetch?: typeof fetch; sign?: typeof signServiceJwt; env?: NodeJS.ProcessEnv };

/** One signed attempt to POST the exact stored transfer. The durable outbox, never
 * this client, retries; it always resends the same bytes. Returns the validated
 * receipt and its canonical form for settleTransfer. */
export async function deliverResumeTransfer(stored: StoredTransfer, signal: AbortSignal, deps: Deps = {}) {
  const transfer = verifyStoredTransfer(stored);
  let origin: string;
  try { origin = foundationMemoryOrigin(deps.env); } catch { throw new ResumeTransferError('memory_unavailable'); }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dispatched = false;
  const fail = () => new ResumeTransferError(dispatched ? 'delivery_outcome_unknown' : 'memory_unavailable');
  const operation = async () => {
    const token = await (deps.sign ?? signServiceJwt)('activekg', { tenantId: `candidate_${transfer.subjectId}`,
      scopes: 'candidate-profile:owner-write', actorType: 'service', requestId: transfer.commandId, lifetimeSeconds: 60 });
    if (controller.signal.aborted) throw fail();
    dispatched = true;
    const response = await (deps.fetch ?? fetch)(`${origin}${RESUME_PATH}`, {
      method: 'POST', redirect: 'error', signal: controller.signal, body: stored.canonical,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-command-sha256': stored.sha256,
        'X-Candidate-Binding-ID': transfer.bindingId, 'X-Candidate-Command-ID': transfer.commandId },
    });
    if (response.status !== 200 && response.status !== 201) {
      void response.body?.cancel().catch(() => {});
      if (response.status === 409) throw new ResumeTransferError('command_conflict');
      if (response.status === 422) throw new ResumeTransferError('invalid_request');
      if (response.status === 401 || response.status === 403) throw new ResumeTransferError('identity_conflict');
      if (response.status === 451) throw new ResumeTransferError('candidate_privacy_restricted');
      if (response.status === 503) throw new ResumeTransferError('memory_unavailable');
      throw new ResumeTransferError('delivery_outcome_unknown');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ResumeTransferError('delivery_outcome_unknown');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        if (controller.signal.aborted) throw new ResumeTransferError('delivery_outcome_unknown');
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > RESUME_RECEIPT_MAX_BYTES) { cancel(); throw new ResumeTransferError('delivery_outcome_unknown'); }
        chunks.push(value);
      }
    } finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    let receipt: ResumeSourceReceipt;
    try {
      receipt = resumeSourceReceiptSchema.parse(parseProfileJson(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), RESUME_RECEIPT_MAX_BYTES));
    } catch { throw new ResumeTransferError('delivery_outcome_unknown'); }
    if (receipt.commandId !== transfer.commandId || receipt.subjectId !== transfer.subjectId || receipt.bindingId !== transfer.bindingId
      || receipt.sourceId !== transfer.sourceId || receipt.sourceVersion !== transfer.sourceVersion || receipt.commandHash !== stored.sha256
      || receipt.proposalId !== transfer.proposal.proposalId || receipt.proposalHash !== transfer.proposal.proposalHash)
      throw new ResumeTransferError('identity_conflict');
    const canonical = canonicalProfileJson(receipt);
    return { receipt, document: { canonical, sha256: sha(canonical) } };
  };
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(fail()); }, RESUME_TRANSFER_DEADLINE_MS);
      controller.signal.addEventListener('abort', () => reject(fail()), { once: true });
      if (controller.signal.aborted) reject(fail());
    })]);
  } catch (error) {
    if (error instanceof ResumeTransferError) throw error;
    throw fail();
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
  }
}
