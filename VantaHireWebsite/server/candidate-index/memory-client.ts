import { createHash } from "node:crypto";
import { z } from "zod";
import { signServiceJwt } from "../lib/services/jwt-signer";
import { candidateIndexCommandKey, CANDIDATE_INDEX_LIMITS } from "./contracts";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.number().int().positive().max(2_147_483_647);
const timestamp = z.string().datetime({ precision: 3 });
const MAX_RESPONSE_BYTES = 64 * 1024;

export const candidateIndexEnvelopeSchema = z.object({
  schema_version: z.literal(1), reference_id: uuid, resume_version_id: uuid,
  application_id: id, job_id: id, source_version: z.literal(1),
  content_sha256: digest, byte_count: z.number().int().min(1).max(CANDIDATE_INDEX_LIMITS.originalBytes),
  media_type: z.enum(["application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  source_observed_at: timestamp, captured_at: timestamp,
  content_kind: z.enum(["pinned_text", "original_bytes"]), payload_sha256: digest,
  content: z.string().min(1).max(4 * Math.ceil(CANDIDATE_INDEX_LIMITS.originalBytes / 3)),
  idempotency_key: digest,
  privacy_subject: z.array(z.object({
    identifier_type: z.enum(["email", "phone", "vantahire_application_id", "vantahire_resume_id"]),
    value: z.string().min(1).max(2048),
  }).strict()).min(1).max(4),
}).strict();
export type CandidateIndexEnvelope = z.infer<typeof candidateIndexEnvelopeSchema>;
const receiptSchema = z.object({
  outcome: z.enum(["accepted", "replayed"]), idempotency_key: digest,
  command_digest: digest, reference_id: uuid, resume_version_id: uuid, source_id: uuid,
}).strict();
export type CandidateIndexReceipt = z.infer<typeof receiptSchema>;
export type CandidateIndexFailure = "privacy_restricted" | "privacy_unavailable" | "source_missing"
  | "source_mismatch" | "network" | "timeout" | "rate_limited" | "receiver_unavailable"
  | "receiver_rejected" | "response_mismatch";

export class CandidateIndexMemoryError extends Error {
  constructor(public readonly code: CandidateIndexFailure) { super(code); }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Only immutable wire fields enter replay equality; privacy is re-admitted. */
export function candidateIndexCommandDigest(envelope: CandidateIndexEnvelope, tenant: string): string {
  const { content: _content, privacy_subject: _privacy, idempotency_key: _key, ...immutable } = envelope;
  const fields: Record<string, unknown> = { ...immutable, tenant_id: tenant };
  return sha256(JSON.stringify(Object.fromEntries(Object.keys(fields).sort().map(key => [key, fields[key]]))));
}

export function validateCandidateIndexEnvelope(value: unknown, tenant: string): CandidateIndexEnvelope {
  const result = candidateIndexEnvelopeSchema.safeParse(value);
  if (!result.success) throw new CandidateIndexMemoryError("source_mismatch");
  const command = result.data;
  try {
    if (candidateIndexCommandKey({
      tenant, referenceId: command.reference_id, resumeVersionId: command.resume_version_id,
      sourceVersion: command.source_version, contentSha256: command.content_sha256,
      contentKind: command.content_kind, payloadSha256: command.payload_sha256,
    }) !== command.idempotency_key) throw new Error();
    const raw = Buffer.from(command.content, command.content_kind === "original_bytes" ? "base64" : "utf8");
    if (command.content_kind === "original_bytes") {
      if (raw.length !== command.byte_count || raw.toString("base64") !== command.content
        || sha256(raw) !== command.content_sha256) throw new Error();
    } else if (raw.length > CANDIDATE_INDEX_LIMITS.textBytes || raw.includes(0)
      || raw.toString("utf8") !== command.content) throw new Error();
    if (sha256(raw) !== command.payload_sha256) throw new Error();
    const pairs = command.privacy_subject.map(item => JSON.stringify([item.identifier_type, item.value]));
    if (new Set(pairs).size !== pairs.length || command.privacy_subject.filter(item =>
      item.identifier_type === "vantahire_application_id" && item.value === String(command.application_id)).length !== 1) throw new Error();
    if (Buffer.byteLength(JSON.stringify(command)) > CANDIDATE_INDEX_LIMITS.requestBytes) throw new Error();
  } catch { throw new CandidateIndexMemoryError("source_mismatch"); }
  return command;
}

function baseUrl(env: NodeJS.ProcessEnv): string {
  try {
    const url = new URL(env.ACTIVEKG_BASE_URL ?? "");
    const local = env.NODE_ENV !== "production" && url.protocol === "http:"
      && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { throw new CandidateIndexMemoryError("network"); }
}

function statusError(status: number): CandidateIndexMemoryError {
  if (status === 451) return new CandidateIndexMemoryError("privacy_restricted");
  if (status === 429) return new CandidateIndexMemoryError("rate_limited");
  if ([408, 425].includes(status) || status >= 500) return new CandidateIndexMemoryError("receiver_unavailable");
  return new CandidateIndexMemoryError("receiver_rejected");
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if ((length !== null && (!/^[0-9]+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))
    || response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json"
    || response.body === null) {
    void response.body?.cancel().catch(() => undefined);
    throw new CandidateIndexMemoryError("response_mismatch");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CandidateIndexMemoryError("response_mismatch");
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted) throw new CandidateIndexMemoryError("timeout");
    if (error instanceof CandidateIndexMemoryError) throw error;
    throw new CandidateIndexMemoryError("response_mismatch");
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** One attempt only. The processor owns leases/retries and the immediate privacy proof. */
export async function deliverCandidateIndex(input: {
  envelope: CandidateIndexEnvelope;
  organizationId: number;
  outboxId: string;
  beforeAttempt: () => Promise<void>;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<CandidateIndexReceipt> {
  const tenant = `org_${input.organizationId}`;
  const command = validateCandidateIndexEnvelope(input.envelope, tenant);
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1
    || input.timeoutMs > CANDIDATE_INDEX_LIMITS.httpTimeoutMs || !uuid.safeParse(input.outboxId).success) {
    throw new CandidateIndexMemoryError("source_mismatch");
  }
  const url = baseUrl(process.env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const signal = input.signal ? AbortSignal.any([controller.signal, input.signal]) : controller.signal;
  let onAbort: () => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => {
    onAbort = () => reject(new CandidateIndexMemoryError("timeout"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const attempt = async () => {
    signal.throwIfAborted();
    const token = await signServiceJwt("activekg", { tenantId: tenant,
      scopes: "organization-candidate-source:write", requestId: input.outboxId });
    signal.throwIfAborted();
    await input.beforeAttempt();
    signal.throwIfAborted();
    const response = await (input.fetchImpl ?? fetch)(`${url}/organization-candidates/source-content`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    if (![200, 201].includes(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      throw statusError(response.status);
    }
    const parsed = receiptSchema.safeParse(await responseJson(response, signal));
    if (!parsed.success || parsed.data.outcome !== (response.status === 201 ? "accepted" : "replayed")
      || parsed.data.idempotency_key !== command.idempotency_key
      || parsed.data.reference_id !== command.reference_id
      || parsed.data.resume_version_id !== command.resume_version_id
      || parsed.data.command_digest !== candidateIndexCommandDigest(command, tenant)) {
      throw new CandidateIndexMemoryError("response_mismatch");
    }
    return parsed.data;
  };
  try { return await Promise.race([attempt(), deadline]); }
  catch (error) {
    if (error instanceof CandidateIndexMemoryError) throw error;
    throw new CandidateIndexMemoryError(signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
