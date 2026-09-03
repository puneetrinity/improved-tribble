import { signServiceJwt } from "../lib/services/jwt-signer";
import {
  decisionProjectionReceiptSchema,
  type ClaimedDecisionProjection,
  type DecisionProjectionReceipt,
  type SafeDeliveryErrorCode,
} from "./models";

const MAX_RESPONSE_BYTES = 64 * 1024;

export class DecisionProjectionMemoryError extends Error {
  constructor(
    public readonly code: SafeDeliveryErrorCode,
    public readonly retryable: boolean,
  ) {
    super(`decision_projection_memory_${code}`);
  }
}

function memoryBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.ACTIVEKG_BASE_URL?.trim();
  if (!value) throw new DecisionProjectionMemoryError("network", true);
  return value.replace(/\/+$/, "");
}

function statusError(status: number): DecisionProjectionMemoryError {
  if (status === 408) return new DecisionProjectionMemoryError("remote_408", true);
  if (status === 425) return new DecisionProjectionMemoryError("remote_425", true);
  if (status === 429) return new DecisionProjectionMemoryError("remote_429", true);
  if (status >= 500) return new DecisionProjectionMemoryError("remote_5xx", true);
  if (status === 400) return new DecisionProjectionMemoryError("remote_400", false);
  if (status === 401) return new DecisionProjectionMemoryError("remote_401", false);
  if (status === 403) return new DecisionProjectionMemoryError("remote_403", false);
  if (status === 409) return new DecisionProjectionMemoryError("payload_conflict", false);
  if (status === 422) return new DecisionProjectionMemoryError("remote_422", false);
  return new DecisionProjectionMemoryError("invalid_response", false);
}

export async function deliverDecisionProjection(
  claim: ClaimedDecisionProjection,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<DecisionProjectionReceipt> {
  const token = await signServiceJwt("activekg", {
    tenantId: `org_${claim.envelope.organization_id}`,
    scopes: "decision-history:write",
    requestId: claim.envelope.event_id,
  });
  let response: Response;
  try {
    response = await fetchImpl(`${memoryBaseUrl()}/organization-decision-events/ingest`, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(claim.envelope),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DecisionProjectionMemoryError) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new DecisionProjectionMemoryError("timeout", true);
    }
    throw new DecisionProjectionMemoryError("network", true);
  }
  if (!response.ok) throw statusError(response.status);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(length) || length > MAX_RESPONSE_BYTES) {
    throw new DecisionProjectionMemoryError("invalid_response", false);
  }
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    throw new DecisionProjectionMemoryError("invalid_response", false);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
    throw new DecisionProjectionMemoryError("invalid_response", false);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DecisionProjectionMemoryError("invalid_response", false);
  }
  const receipt = decisionProjectionReceiptSchema.safeParse(parsed);
  if (!receipt.success
      || receipt.data.event_id !== claim.envelope.event_id
      || receipt.data.delivery_sequence !== claim.envelope.delivery_sequence) {
    throw new DecisionProjectionMemoryError("invalid_response", false);
  }
  return receipt.data;
}
