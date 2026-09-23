import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { CandidatePrivacyRestrictedError } from "../candidate-privacy/decision";
import { requireOrganizationCandidateApplicationAllowed } from "../organization-candidates/application-intake";
import { candidateIndexCommandKey, candidateIndexMode, candidateIndexWebConfig, CANDIDATE_INDEX_LIMITS } from "./contracts";
import {
  CandidateIndexMemoryError, deliverCandidateIndex, validateCandidateIndexEnvelope,
  type CandidateIndexEnvelope, type CandidateIndexFailure,
} from "./memory-client";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.number().int().positive().max(2_147_483_647);
const claimSchema = z.object({
  outbox_id: uuid, organization_id: id, application_id: id, job_id: id,
  reference_id: uuid, resume_version_id: uuid, source_version: z.literal(1),
  content_sha256: digest, content_kind: z.enum(["pinned_text", "original_bytes"]),
  payload_sha256: digest, idempotency_key: digest, attempt: z.number().int().min(1).max(8),
  // pg returns int8 as a string. Only this database boundary permits canonical conversion.
  generation: z.union([z.number(), z.string().regex(/^[1-9][0-9]{0,15}$/).transform(Number)])
    .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
  lease_token: uuid, lease_expires_at: z.date(),
}).strict();
type Claim = z.infer<typeof claimSchema>;
interface Queryable { query(text: string, values?: unknown[]): Promise<{ rows: any[] }>; }
type Config = ReturnType<typeof candidateIndexWebConfig>;

export class CandidateIndexLegacyFenceError extends Error {
  constructor(readonly code: "managed" | "busy" | "unavailable") {
    super(`candidate_index_legacy_${code}`);
  }
}

interface LegacyFenceConnection extends Queryable {
  on(event: "error", listener: () => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
  release(destroy?: boolean): void;
}

// A session lock spans the legacy work, NOT a database transaction. Catchup's
// existing definer takes the same key transactionally before adoption. Both use
// try-locks: neither waits behind an unbounded legacy transport or holds a row
// transaction while doing network work. An uncertain old attempt is not eligible
// for catchup merely because its processing lease expires.
export async function withLegacyCandidateIndexFence<T>(organizationId: number | null,
  applicationId: number, work: (check: () => Promise<void>) => Promise<T>, options: {
    env?: NodeJS.ProcessEnv; pool?: { connect(): Promise<LegacyFenceConnection> };
  } = {}): Promise<T> {
  const env = options.env ?? process.env;
  let mode;
  try { mode = candidateIndexMode(env); }
  catch { throw new CandidateIndexLegacyFenceError("unavailable"); }
  // Null org still takes the unchanged worker's prerequisite refusal.
  if (mode === null || organizationId === null) return work(async () => {});
  if (!id.safeParse(organizationId).success || !id.safeParse(applicationId).success) {
    throw new CandidateIndexLegacyFenceError("unavailable");
  }
  let client: LegacyFenceConnection;
  try { client = await (options.pool ?? (await import("../db")).pool).connect(); }
  catch { throw new CandidateIndexLegacyFenceError("unavailable"); }
  let locked = false, lost = false;
  const lostConnection = () => { lost = true; };
  client.on("error", lostConnection);
  const check = async () => {
    if (lost) throw new CandidateIndexLegacyFenceError("unavailable");
    let managed;
    try { managed = await applicationUsesPrivateIndex(organizationId, applicationId, { env, db: client }); }
    catch { throw new CandidateIndexLegacyFenceError("unavailable"); }
    if (lost) throw new CandidateIndexLegacyFenceError("unavailable");
    if (managed) throw new CandidateIndexLegacyFenceError("managed");
  };
  try {
    let row;
    try {
      row = (await client.query(
        "SELECT pg_try_advisory_lock(hashtext('flow:candidate-index:legacy'),$1) AS acquired",
        [applicationId],
      )).rows[0];
    } catch {
      // The server may have acquired it before the reply was lost. Never return
      // a session with an unknown lock state to the shared pool.
      lost = true;
      throw new CandidateIndexLegacyFenceError("unavailable");
    }
    if (row?.acquired === false) throw new CandidateIndexLegacyFenceError("busy");
    if (row?.acquired !== true) { lost = true; throw new CandidateIndexLegacyFenceError("unavailable"); }
    locked = true;
    await check();
    return await work(check);
  } finally {
    if (locked && !lost) {
      try {
        const row = (await client.query(
          "SELECT pg_advisory_unlock(hashtext('flow:candidate-index:legacy'),$1) AS released",
          [applicationId],
        )).rows[0];
        if (row?.released !== true) lost = true;
      } catch { lost = true; }
    }
    client.removeListener("error", lostConnection);
    client.release(lost);
  }
}

// A mode is not evidence of adoption. Only the exact committed application/org
// tuple in the insert-only outbox may retire that application's legacy bridge.
// The runtime has no SELECT on that outbox; use the existing bounded definer.
export async function applicationUsesPrivateIndex(organizationId: number, applicationId: number,
  options: { env?: NodeJS.ProcessEnv; db?: Queryable } = {}): Promise<boolean> {
  try {
    if (candidateIndexMode(options.env ?? process.env) !== "private_primary") return false;
    id.parse(organizationId); id.parse(applicationId);
    const db: Queryable = options.db ?? (await import("../db")).pool;
    const result = await db.query(
      "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed",
      [organizationId, applicationId],
    );
    if (result.rows.length !== 1 || typeof result.rows[0]?.managed !== "boolean") {
      throw new Error("CANDIDATE_INDEX_LEGACY_GATE_UNAVAILABLE");
    }
    return result.rows[0].managed;
  } catch {
    // Never expose database errors or convert unavailable authority into allow.
    throw new Error("CANDIDATE_INDEX_LEGACY_GATE_UNAVAILABLE");
  }
}

export async function shouldEnqueueLegacyApplication(organizationId: number, applicationId: number,
  options: { env?: NodeJS.ProcessEnv; db?: Queryable } = {}): Promise<boolean> {
  try {
    return !await applicationUsesPrivateIndex(organizationId, applicationId, options);
  } catch {
    // This is after commit: fail closed for the legacy write, never the apply.
    console.warn("[ACTIVEKG_SYNC] Legacy adoption check unavailable (non-blocking)");
    return false;
  }
}

// This is a fixed program, never generated from an applicant locator or environment value.
// The shell applies kernel limits before Node or any storage dependency is loaded.
export const INDEX_DOWNLOAD_LIMITS = 'ulimit -v 262144 && ulimit -t 20 && ulimit -c 0 && exec "$@"';
export const INDEX_FETCH_LIMITS = 'ulimit -t 20 && ulimit -c 0 && exec "$@"';
export const INDEX_DOWNLOAD_CHILD = String.raw`
console.log = console.warn = console.error = console.info = console.debug = () => {};
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
(async () => {
  const limits = fs.readFileSync('/proc/self/limits', 'utf8');
  if (!/^Max cpu time\s+20\s+20\s+seconds[ \t]*$/m.test(limits)
    || !/^Max core file size\s+0\s+0\s+bytes[ \t]*$/m.test(limits)) process.exit(65);
  let input = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    if (input.length + chunk.length > 8192) process.exit(65);
    input = Buffer.concat([input, chunk]);
  }
  const request = JSON.parse(input.toString('utf8'));
  if (!request || Object.keys(request).sort().join(',') !== 'byteCount,contentSha256,locator,mediaType'
    || typeof request.locator !== 'string' || request.locator.length > 2048
    || !Number.isInteger(request.byteCount) || request.byteCount < 1 || request.byteCount > 5242880
    || !/^[0-9a-f]{64}$/.test(request.contentSha256)) process.exit(65);
  const artifact = process.argv[1];
  const gcs = require(artifact);
  const bytes = await gcs.downloadBoundApplicationResumeFromGCS(request.locator);
  if (!Buffer.isBuffer(bytes) || bytes.length !== request.byteCount || bytes.length > 5242880
    || crypto.createHash('sha256').update(bytes).digest('hex') !== request.contentSha256) process.exit(65);
  process.stdout.write(bytes);
})().catch(() => { process.exitCode = 69; });
`;

// No storage artifact or credentials in this child. Install the network fence
// before loading the type detector or accepting untrusted bytes.
export const INDEX_VALIDATE_CHILD = String.raw`
console.log = console.warn = console.error = console.info = console.debug = () => {};
const fs = require('node:fs'), crypto = require('node:crypto');
let forbidden = false;
const refuse = () => { forbidden = true; throw Error('network_refused'); };
require('node:net').Socket.prototype.connect = refuse;
require('node:dgram').createSocket = refuse;
require('node:tls').connect = refuse;
require('node:dns').lookup = refuse;
globalThis.fetch = refuse;
(async () => {
  const limits = fs.readFileSync('/proc/self/limits', 'utf8');
  if (!process.execArgv.includes('--jitless')
    || !/^Max address space\s+268435456\s+268435456\s+bytes[ \t]*$/m.test(limits)
    || !/^Max cpu time\s+20\s+20\s+seconds[ \t]*$/m.test(limits)
    || !/^Max core file size\s+0\s+0\s+bytes[ \t]*$/m.test(limits)) process.exit(65);
  const fileType = require(process.argv[1]);
  let input = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    if (input.length + chunk.length > 5242880 + 8193) process.exit(65);
    input = Buffer.concat([input, chunk]);
  }
  const boundary = input.indexOf(10);
  if (boundary < 1 || boundary > 8192) process.exit(65);
  const request = JSON.parse(input.subarray(0, boundary).toString('utf8'));
  const bytes = input.subarray(boundary + 1);
  if (!Number.isInteger(request.byteCount) || request.byteCount < 1
    || bytes.length !== request.byteCount || bytes.length > 5242880
    || crypto.createHash('sha256').update(bytes).digest('hex') !== request.contentSha256) process.exit(65);
  const detected = await fileType.fromBuffer(bytes);
  const ole = bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
  if (detected?.mime !== request.mediaType && !(ole && request.mediaType === 'application/msword')) process.exit(65);
  if (forbidden) process.exit(65);
  process.stdout.write(bytes);
})().catch(() => { process.exitCode = 69; });
`;

type Original = { locator: string; byteCount: number; contentSha256: string; mediaType: string };
export async function downloadCandidateIndexOriginal(input: Original, options: {
  signal: AbortSignal; timeoutMs?: number; artifact?: string; env?: NodeJS.ProcessEnv;
  launch?: typeof spawn;
}): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const request = JSON.stringify(input);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000
    || Buffer.byteLength(request) > 8192) throw new CandidateIndexMemoryError("source_mismatch");
  if (options.signal.aborted) throw new CandidateIndexMemoryError("timeout");
  const env = options.env ?? process.env;
  const childEnv: NodeJS.ProcessEnv = { LANG: "C.UTF-8", NODE_ENV: "production" };
  for (const name of ["GCS_PROJECT_ID", "GCS_BUCKET_NAME", "GCS_SERVICE_ACCOUNT_KEY"] as const) {
    if (!env[name]?.trim()) throw new CandidateIndexMemoryError("network");
    childEnv[name] = env[name];
  }
  const artifact = options.artifact ?? resolve(process.cwd(), "dist/candidate-index-gcs.cjs");
  // Emulator routing is test-only, loopback-only, and never inherited implicitly.
  if (env.STORAGE_EMULATOR_HOST) {
    const endpoint = new URL(env.STORAGE_EMULATOR_HOST);
    if (env.NODE_ENV !== "test" || endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1"
      || !endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== "/"
      || endpoint.search || endpoint.hash) throw new CandidateIndexMemoryError("network");
    childEnv.STORAGE_EMULATOR_HOST = endpoint.origin;
  }
  const launch = options.launch ?? spawn;
  const deadline = Date.now() + timeoutMs;
  const run = (strict: boolean, stdin: Buffer) => new Promise<Buffer>((accept, refuse) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || options.signal.aborted) return refuse(new CandidateIndexMemoryError("timeout"));
    const args = strict ? ["--jitless", "--max-old-space-size=48", "--v8-pool-size=1"]
      : ["--max-old-space-size=48", "--v8-pool-size=1"];
    const child = launch("/bin/sh", ["-c", strict ? INDEX_DOWNLOAD_LIMITS : INDEX_FETCH_LIMITS, "index-download",
      process.execPath, ...args, "-e", strict ? INDEX_VALIDATE_CHILD : INDEX_DOWNLOAD_CHILD,
      strict ? resolve(process.cwd(), "node_modules/file-type/index.js") : artifact],
    { env: strict ? { LANG: "C.UTF-8", NODE_ENV: "production" } : childEnv,
      stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    let failure: CandidateIndexFailure | null = null;
    let size = 0;
    const chunks: Buffer[] = [];
    const stop = (code: CandidateIndexFailure) => {
      failure ??= code;
      child.kill("SIGKILL");
    };
    const abort = () => stop("timeout");
    const timer = setTimeout(abort, remaining);
    options.signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => { failure ??= "network"; });
    child.stdin.on("error", () => stop("network"));
    child.stdout.on("error", () => stop("network"));
    child.stdout.on("data", (part: Buffer) => {
      size += part.length;
      if (size > CANDIDATE_INDEX_LIMITS.originalBytes) stop("source_mismatch");
      else chunks.push(part);
    });
    // close, not kill()/exit, is the proof that the child and its pipe are gone.
    child.once("close", code => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      if (failure) return refuse(new CandidateIndexMemoryError(failure));
      if (code !== 0) return refuse(new CandidateIndexMemoryError(code === 65 ? "source_mismatch" : "network"));
      const bytes = Buffer.concat(chunks);
      if (bytes.length !== input.byteCount || sha(bytes) !== input.contentSha256) {
        return refuse(new CandidateIndexMemoryError("source_mismatch"));
      }
      accept(bytes);
    });
    if (options.signal.aborted) abort();
    else child.stdin.end(stdin);
  });
  const bytes = await run(false, Buffer.from(request));
  return run(true, Buffer.concat([Buffer.from(request + "\n"), bytes]));
}

export function candidateIndexProcessorConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = candidateIndexWebConfig(env);
  if (config.mode && (process.platform !== "linux" || !existsSync("/bin/sh")
    || !existsSync(resolve(process.cwd(), "dist/candidate-index-gcs.cjs"))
    || !env.GCS_PROJECT_ID?.trim() || !env.GCS_BUCKET_NAME?.trim() || !env.GCS_SERVICE_ACCOUNT_KEY?.trim())) {
    throw new Error("CANDIDATE_INDEX_STORAGE_CHILD_UNAVAILABLE");
  }
  return config;
}

async function sourceForClaim(claim: Claim, db: Queryable): Promise<any> {
  // The definer claim has already bound the exact terminal 4B acknowledgement.
  // Runtime cannot SELECT that insert-only outbox. Its ack/fail routines cannot
  // undo acknowledgement; Memory independently checks the immutable receipt.
  // Here (and again at dispatch) recheck the readable source and live ownership.
  const { rows } = await db.query(
    "SELECT r.gcs_locator,r.content_sha256,r.byte_count,r.media_type,r.extracted_text,"
    + "r.extracted_text_sha256,r.source_resume_id,r.source_observed_at,r.captured_at,"
    + "a.email,a.phone FROM public.application_resume_versions r "
    + "JOIN public.applications a ON a.id=r.application_id AND a.organization_id=r.organization_id AND a.job_id=r.job_id "
    + "JOIN public.jobs j ON j.id=a.job_id AND j.organization_id=r.organization_id "
    + "WHERE r.resume_version_id=$1 AND r.reference_id=$2 AND r.organization_id=$3 "
    + "AND r.application_id=$4 AND r.job_id=$5 AND r.version=$6",
    [claim.resume_version_id, claim.reference_id, claim.organization_id,
      claim.application_id, claim.job_id, claim.source_version]);
  if (rows.length !== 1) throw new CandidateIndexMemoryError("source_missing");
  const row = rows[0];
  if (row.content_sha256 !== claim.content_sha256
    || (row.extracted_text_sha256 ?? row.content_sha256) !== claim.payload_sha256
    || (row.extracted_text_sha256 === null ? "original_bytes" : "pinned_text") !== claim.content_kind
    || !Number.isInteger(row.byte_count) || row.byte_count < 1 || row.byte_count > CANDIDATE_INDEX_LIMITS.originalBytes
    || typeof row.email !== "string") throw new CandidateIndexMemoryError("source_mismatch");
  return row;
}

function failureCode(error: unknown): CandidateIndexFailure {
  if (error instanceof CandidateIndexMemoryError) return error.code;
  if (error instanceof CandidatePrivacyRestrictedError) return error.code === "candidate_privacy_restricted"
    ? "privacy_restricted" : "privacy_unavailable";
  return "network"; // No raw exception, locator, identity, token or response is logged.
}

export async function runCandidateIndexProcessorOnce(config: Config, options: {
  db?: Queryable; signal?: AbortSignal; deliver?: typeof deliverCandidateIndex;
  download?: typeof downloadCandidateIndexOriginal;
  admit?: typeof requireOrganizationCandidateApplicationAllowed;
} = {}): Promise<number> {
  if (!config.mode || options.signal?.aborted) return 0;
  const db: Queryable = options.db ?? (await import("../db")).pool;
  const signal = options.signal ?? new AbortController().signal;
  const deliver = options.deliver ?? deliverCandidateIndex;
  const download = options.download ?? downloadCandidateIndexOriginal;
  const admit = options.admit ?? requireOrganizationCandidateApplicationAllowed;
  let count = 0;
  for (; count < config.claimLimit && !signal.aborted; count += 1) {
    // Claim just in time, not eight leases that wait behind seven full deadlines.
    const { rows } = await db.query("SELECT * FROM public.flow_claim_candidate_index_delivery($1,$2)", [1, config.leaseMs]);
    if (!rows.length) break;
    const parsed = claimSchema.safeParse(rows[0]);
    if (!parsed.success || rows.length !== 1) throw new Error("CANDIDATE_INDEX_CLAIM_INVALID");
    const claim = parsed.data;
    try {
      const evidence = await sourceForClaim(claim, db);
      if (candidateIndexCommandKey({ tenant: `org_${claim.organization_id}`, referenceId: claim.reference_id,
        resumeVersionId: claim.resume_version_id, sourceVersion: claim.source_version,
        contentSha256: claim.content_sha256, contentKind: claim.content_kind, payloadSha256: claim.payload_sha256,
      }) !== claim.idempotency_key) throw new CandidateIndexMemoryError("source_mismatch");
      await admit({ applicationId: claim.application_id, email: evidence.email, phone: evidence.phone });
      signal.throwIfAborted();
      const content = claim.content_kind === "pinned_text" ? evidence.extracted_text :
        (await download({ locator: evidence.gcs_locator, byteCount: evidence.byte_count,
          contentSha256: evidence.content_sha256, mediaType: evidence.media_type }, { signal })).toString("base64");
      const privacy: CandidateIndexEnvelope["privacy_subject"] = [
        { identifier_type: "vantahire_application_id", value: String(claim.application_id) },
        { identifier_type: "email", value: evidence.email.trim().toLowerCase() },
        ...(evidence.phone?.trim() ? [{ identifier_type: "phone" as const, value: evidence.phone.trim() }] : []),
        ...(evidence.source_resume_id ? [{ identifier_type: "vantahire_resume_id" as const,
          value: String(evidence.source_resume_id) }] : []),
      ];
      const envelope = validateCandidateIndexEnvelope({ schema_version: 1,
        reference_id: claim.reference_id, resume_version_id: claim.resume_version_id,
        application_id: claim.application_id, job_id: claim.job_id, source_version: claim.source_version,
        content_sha256: claim.content_sha256, byte_count: evidence.byte_count, media_type: evidence.media_type,
        source_observed_at: evidence.source_observed_at.toISOString(), captured_at: evidence.captured_at.toISOString(),
        content_kind: claim.content_kind, payload_sha256: claim.payload_sha256, content,
        idempotency_key: claim.idempotency_key, privacy_subject: privacy,
      }, `org_${claim.organization_id}`);
      const receipt = await deliver({ envelope, organizationId: claim.organization_id,
        outboxId: claim.outbox_id, timeoutMs: config.timeoutMs, signal,
        beforeAttempt: async () => {
          const current = await sourceForClaim(claim, db);
          if (current.email !== evidence.email || current.phone !== evidence.phone) {
            throw new CandidateIndexMemoryError("source_mismatch");
          }
          await admit({ applicationId: claim.application_id, email: current.email, phone: current.phone });
        },
      });
      signal.throwIfAborted();
      await db.query("SELECT public.flow_ack_candidate_index_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9) AS accepted",
        [claim.outbox_id, claim.lease_token, claim.generation, receipt.idempotency_key,
          receipt.reference_id, receipt.resume_version_id, claim.payload_sha256, receipt.source_id, receipt.command_digest]);
    } catch (error) {
      if (signal.aborted) break; // Retain ambiguous reserved work for lease-driven reclaim.
      await db.query("SELECT public.flow_fail_candidate_index_delivery($1,$2,$3,$4,$5) AS failed",
        [claim.outbox_id, claim.lease_token, claim.generation, failureCode(error), Math.min(3600000, 1000 * 2 ** claim.attempt)]);
    }
  }
  return count;
}

export function startCandidateIndexProcessor(config = candidateIndexProcessorConfig()): () => Promise<void> {
  if (!config.mode) return async () => {};
  const controller = new AbortController();
  let current: Promise<unknown> | null = null;
  const tick = () => {
    if (current || controller.signal.aborted) return;
    current = runCandidateIndexProcessorOnce(config, { signal: controller.signal })
      .catch(() => { console.warn("[CandidateIndex] tick unavailable"); })
      .finally(() => { current = null; });
  };
  const timer = setInterval(tick, config.pollMs);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    controller.abort();
    await current;
  };
}
