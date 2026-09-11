import { signServiceJwt } from "../lib/services/jwt-signer";
import { consentIdentity, consentReceiptSchema, privacyProofSchema,
  type ConsentCommand, type ConsentFailureCode, type ConsentGrantProof, type ConsentReceipt } from "./contracts";

export class ConsentDeliveryError extends Error {
  constructor(public readonly code: ConsentFailureCode, public readonly retryable: boolean) { super(code); }
}
export function consentMemoryOrigin(env: NodeJS.ProcessEnv = process.env): string {
  try {
    const url = new URL(env.ACTIVEKG_BASE_URL ?? "");
    const disposable = env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(disposable && url.protocol === "http:"))
      || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw Error();
    return url.origin;
  } catch { throw new ConsentDeliveryError("network", true); }
}
export async function deliverConsent(command: ConsentCommand, proof: ConsentGrantProof | null,
  timeoutMs: number, fetchImpl: typeof fetch = fetch): Promise<ConsentReceipt> {
  const identity = consentIdentity(command);
  if ((command.action === "grant") !== (proof !== null)) throw new ConsentDeliveryError("account_changed", false);
  if (proof) privacyProofSchema.parse(proof.privacy_subject);
  const token = await signServiceJwt("activekg", { tenantId: `candidate_${command.subject_id}`,
    scopes: "candidate-consent:write", requestId: command.event_id, actorType: "service" });
  try {
    const response = await fetchImpl(`${consentMemoryOrigin()}/candidate-consent/events`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ...command, idempotency_key: identity.idempotencyKey, proof }),
    });
    if (!response.ok) {
      if (response.status === 451) throw new ConsentDeliveryError("privacy_restricted", false);
      if ([408, 425, 429].includes(response.status) || response.status >= 500) throw new ConsentDeliveryError("remote_retry", true);
      if (response.status === 409) throw new ConsentDeliveryError("remote_conflict", false);
      throw new ConsentDeliveryError("remote_denied", false);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ConsentDeliveryError("invalid_response", false);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); throw new ConsentDeliveryError("invalid_response", false); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ConsentDeliveryError("invalid_response", false); }
    const parsed = consentReceiptSchema.safeParse(raw);
    if (!parsed.success) throw new ConsentDeliveryError("invalid_response", false);
    const receipt = parsed.data;
    if (receipt.subject_id !== command.subject_id || receipt.event_id !== command.event_id
      || receipt.version !== command.version || receipt.command_digest !== identity.commandDigest
      || receipt.idempotency_key !== identity.idempotencyKey) throw new ConsentDeliveryError("identity_mismatch", false);
    if (["granted", "withdrawn", "replayed"].includes(receipt.outcome)
      && (receipt.effective_version !== command.version || receipt.effective_action !== command.action)) {
      throw new ConsentDeliveryError("identity_mismatch", false);
    }
    return receipt;
  } catch (error) {
    if (error instanceof ConsentDeliveryError) throw error;
    if (error instanceof DOMException && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new ConsentDeliveryError("timeout", true);
    }
    throw new ConsentDeliveryError("network", true);
  }
}
