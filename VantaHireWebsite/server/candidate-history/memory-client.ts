import { signServiceJwt } from "../lib/services/jwt-signer";
import { historyRequest, validateHistoryResponse, type HistoryRequest, type HistoryResponse } from "./contracts";

export type HistoryFailure = "temporarily_unavailable" | "privacy_restricted" | "binding_conflict" | "not_found";
export class HistoryMemoryError extends Error {
  constructor(public readonly code: HistoryFailure) { super(code); }
}

function origin(env: NodeJS.ProcessEnv): string {
  const url = new URL(env.ACTIVEKG_BASE_URL ?? "");
  const local = env.NODE_ENV === "test" && url.protocol === "http:"
    && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("history_origin_invalid");
  return url.origin;
}

export async function readMemoryHistory(input: HistoryRequest, fetchImpl: typeof fetch = fetch): Promise<HistoryResponse> {
  const controller = new AbortController();
  let rejectDeadline!: (error: Error) => void;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    controller.abort(); rejectDeadline(new HistoryMemoryError("temporarily_unavailable"));
  }, 3000);
  const attempt = async () => {
    const request = historyRequest.parse(input);
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > 4096) throw new Error("history_request_invalid");
    const url = origin(process.env);
    const token = await signServiceJwt("activekg", {
      tenantId: `org_${request.organization_id}`, scopes: "decision-history:read",
    });
    controller.signal.throwIfAborted();
    const response = await fetchImpl(`${url}/organization-candidate-history/read`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body,
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      const code = response.status === 451 ? "privacy_restricted" : response.status === 409
        ? "binding_conflict" : response.status === 404 ? "not_found" : "temporarily_unavailable";
      throw new HistoryMemoryError(code);
    }
    const length = response.headers.get("content-length");
    if (!response.body || response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json"
      || (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 65536))) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("history_response_invalid");
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        controller.signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 65536) throw new Error("history_response_invalid");
        chunks.push(part.value);
      }
      controller.signal.throwIfAborted();
      return validateHistoryResponse(JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(Buffer.concat(chunks))), request);
    } catch (error) { cancel(); throw error; }
    finally { controller.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  };
  try { return await Promise.race([attempt(), deadline]); }
  catch (error) {
    if (error instanceof HistoryMemoryError) throw error;
    throw new HistoryMemoryError("temporarily_unavailable");
  } finally { clearTimeout(timer); }
}
