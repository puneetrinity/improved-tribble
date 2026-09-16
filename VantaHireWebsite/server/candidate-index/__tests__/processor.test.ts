import { createHash, generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { importSPKI, jwtVerify } from "jose";
import { clearKeyCache } from "../../lib/services/jwt-signer";
import { candidateIndexCommandKey } from "../contracts";
import { candidateIndexCommandDigest, CandidateIndexMemoryError, deliverCandidateIndex,
  validateCandidateIndexEnvelope, type CandidateIndexEnvelope } from "../memory-client";
import { candidateIndexProcessorConfig, downloadCandidateIndexOriginal,
  runCandidateIndexProcessorOnce, startCandidateIndexProcessor,
  applicationUsesPrivateIndex, shouldEnqueueLegacyApplication, withLegacyCandidateIndexFence } from "../processor";
import { CandidatePrivacyRestrictedError } from "../../candidate-privacy/decision";
import { censusApplicationCatchup, executeApplicationCatchup, saveApplicationCatchupPlan,
  CATCHUP_ATTEMPTS_PER_SOURCE } from "../catchup";

vi.mock("../../db", () => ({ db: {}, pool: { query: vi.fn() } }));

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
describe("bounded application catchup", () => {
  const secret = Buffer.alloc(32, 7);
  const posture = { flowTarget: "flow-fixture", memoryTarget: "memory-fixture", flowTree: "a".repeat(40),
    memoryTree: "b".repeat(40), legacyWorkerTree: "a".repeat(40), policySha256: "c".repeat(64),
    mode: "private_primary" as const, running: true as const };
  const source = "22222222-2222-4222-8222-222222222222";
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "flow-catchup-unit-")); vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "private_primary"); });
  afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
  function fixture() {
    let tick = Date.now();
    let row: any = { resume_version_id: source, reference_id: "11111111-1111-4111-8111-111111111111",
      organization_id: 17, application_id: 23, job_id: 31, version: 1, source_kind: "direct_upload", source_resume_id: null,
      source_observed_at: new Date(tick - 1000), captured_at: new Date(tick - 1000),
      content_sha256: sha("ORIGINAL"), byte_count: 8, media_type: "application/pdf", gcs_locator: "gs://synthetic-only/resume.pdf",
      extracted_text: "IMMUTABLE", extracted_text_sha256: sha("IMMUTABLE"), live_application: 23, live_job: 31,
      email: "catchup-sentinel@example.invalid", phone: null, bindings: 1, origin_code: "candidate_applied",
      intake_state: "acknowledged", memory_candidate_id: "33333333-3333-4333-8333-333333333333",
      legacy_status: null, legacy_attempts: null, managed: false };
    const read = Object.assign(new EventEmitter(), { release: vi.fn(), query: vi.fn(async (sql: string) => {
      if (sql.includes("schema_control.identity")) return { rows: [{ target_id: posture.flowTarget }] };
      if (sql.startsWith("SHOW")) return { rows: [{ transaction_read_only: "on" }] };
      if (sql.startsWith("SELECT r.*")) return { rows: row ? [{ ...row }] : [] };
      return { rows: [] };
    }) });
    const write = Object.assign(new EventEmitter(), { release: vi.fn(), query: vi.fn(async (sql: string) => {
      if (sql.includes("schema_control.identity")) return { rows: [{ target_id: posture.flowTarget }] };
      if (sql.includes("advisory")) return { rows: [{ ok: true }] };
      if (sql.includes("flow_capture_candidate_index_catchup")) { row.managed = true; return { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] }; }
      return { rows: [] };
    }) });
    const deps = { readPool: { connect: vi.fn(async () => read) }, readRunningPosture: vi.fn(async () => ({ ...posture })),
      admit: vi.fn(async () => undefined), download: vi.fn(async () => Buffer.from("ORIGINAL")), now: () => tick };
    const census = (patch = {}) => censusApplicationCatchup({ maxRows: 10, maxProviderAttempts: 50,
      lifetimeMs: 60_000, key: secret, ...patch }, deps);
    const execute = (plan: unknown, patch = {}) => executeApplicationCatchup({ plan, key: secret,
      journalPath: join(directory, "journal"), writePool: { connect: vi.fn(async () => write) }, operatorApproved: true, ...patch }, deps);
    return { deps, read, write, census, execute, get row() { return row; }, replace: (next: any) => { row = next; }, advance: (n: number) => { tick += n; } };
  }
  it("seals exact evidence, two targets, authority, policy, cursor and a hard attempt ceiling without writes", async () => {
    const f = fixture(), plan = await f.census();
    expect(plan.entries).toHaveLength(1); expect(plan.posture).toEqual(posture);
    expect(plan.entries[0]).toMatchObject({ sourceId: source, organizationId: 17 });
    expect(plan.nextCursor).toBe(source); expect(CATCHUP_ATTEMPTS_PER_SOURCE).toBe(5);
    expect(f.write.query).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toMatch(/catchup-sentinel|gs:\/\/|IMMUTABLE|ORIGINAL/);
    expect(f.read.query.mock.calls.some(([sql]) => sql === "BEGIN READ ONLY")).toBe(true);
    expect(f.read.release).toHaveBeenCalledWith(false);
    await expect(f.census({ maxProviderAttempts: 4 })).rejects.toThrow("candidate_index_catchup_refused");
  });
  it.each([
    ["source_orphaned", { live_application: null }], ["source_orphaned", { live_job: null }],
    ["binding_ambiguous", { bindings: 2 }], ["intake_unacknowledged", { intake_state: "pending" }],
    ["source_mismatch", { extracted_text: "mutable replacement" }], ["already_managed", { managed: true }],
    ["legacy_busy", { legacy_status: "processing", legacy_attempts: 1 }],
    ["legacy_uncertain", { legacy_status: "succeeded", legacy_attempts: 2 }],
    ["legacy_uncertain", { legacy_status: "failed", legacy_attempts: 1 }],
  ])("reports %s without attempting adoption", async (reason, patch) => {
    const f = fixture(); Object.assign(f.row, patch);
    const plan = await f.census(); expect(plan.entries).toEqual([]); expect(plan.skipped).toEqual({ [reason as string]: 1 });
    expect(f.write.query).not.toHaveBeenCalled(); expect(f.deps.download).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "changed"])("refuses an %s original rather than rebuilding text", async kind => {
    const f = fixture();
    if (kind === "unavailable") f.deps.download.mockRejectedValue(Error("storage-secret-sentinel"));
    else f.deps.download.mockResolvedValue(Buffer.from("DIFFERENT"));
    expect((await f.census()).skipped).toEqual({ object_unavailable: 1 });
  });
  it("distinguishes private restriction from privacy unavailability", async () => {
    const f = fixture(); f.deps.admit.mockRejectedValue(new CandidatePrivacyRestrictedError("candidate_privacy_restricted"));
    expect((await f.census()).skipped).toEqual({ privacy_restricted: 1 });
    f.deps.admit.mockRejectedValue(Error("private-sentinel"));
    expect((await f.census()).skipped).toEqual({ privacy_unavailable: 1 });
  });
  it("captures once, fsyncs a chained result, then resumes without another capture", async () => {
    const f = fixture(), plan = await f.census();
    expect(await f.execute(plan)).toEqual({ captured: 1 });
    expect(await f.execute(plan)).toEqual({ captured: 1 });
    expect(f.write.query.mock.calls.filter(([sql]) => sql.includes("flow_capture_candidate_index_catchup"))).toHaveLength(1);
    expect(statSync(join(directory, "journal")).mode & 0o777).toBe(0o600);
    expect(f.write.listenerCount("error")).toBe(0);
  });
  it("a committed intent before journal append resumes as already managed; never buys twice", async () => {
    const f = fixture(), plan = await f.census(); f.row.managed = true;
    appendFileSync(join(directory, "journal"), '{"seq":0,"source', { mode: 0o600 });
    expect(await f.execute(plan)).toEqual({ already_managed: 1 });
    expect(f.write.query.mock.calls.some(([sql]) => sql.includes("flow_capture_candidate_index_catchup"))).toBe(false);
    expect(JSON.parse(readFileSync(join(directory, "journal"), "utf8")).outcome).toBe("already_managed");
  });
  it("never repairs a tampered complete journal record", async () => {
    const f = fixture(), plan = await f.census(); await f.execute(plan);
    const path = join(directory, "journal"), data = readFileSync(path, "utf8").replace('"captured"', '"source_orphaned"');
    writeFileSync(path, data); await expect(f.execute(plan)).rejects.toThrow("candidate_index_catchup_refused");
    expect(readFileSync(path, "utf8")).toBe(data);
  });
  it.each(["plan", "key", "expired", "posture", "unapproved", "mode"])("refuses %s before capture", async kind => {
    const f = fixture(); let plan: any = await f.census(), patch = {};
    if (kind === "plan") plan = { ...plan, maxRows: 9 };
    if (kind === "key") patch = { key: Buffer.alloc(32, 8) };
    if (kind === "expired") f.advance(60_000);
    if (kind === "posture") f.deps.readRunningPosture.mockResolvedValue({ ...posture, policySha256: "d".repeat(64) });
    if (kind === "unapproved") patch = { operatorApproved: false };
    if (kind === "mode") vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "dual");
    await expect(f.execute(plan, patch)).rejects.toThrow("candidate_index_catchup_refused");
    expect(f.write.query.mock.calls.some(([sql]) => sql.includes("flow_capture_candidate_index_catchup"))).toBe(false);
  });
  it("rechecks evidence and admission after storage waits", async () => {
    const f = fixture(), plan = await f.census();
    f.deps.download.mockImplementation(async () => { f.row.email = "changed@example.invalid"; return Buffer.from("ORIGINAL"); });
    expect(await f.execute(plan)).toEqual({ source_mismatch: 1 });
    expect(f.write.query.mock.calls.some(([sql]) => sql.includes("flow_capture_candidate_index_catchup"))).toBe(false);
  });
  it("session loss during storage never captures or appends; connection is destroyed", async () => {
    const f = fixture(), plan = await f.census();
    f.deps.download.mockImplementation(async () => { f.write.emit("error", Error("private-sentinel")); return Buffer.from("ORIGINAL"); });
    await expect(f.execute(plan)).rejects.toThrow("candidate_index_catchup_refused");
    expect(f.write.query.mock.calls.some(([sql]) => sql.includes("flow_capture_candidate_index_catchup"))).toBe(false);
    expect(readFileSync(join(directory, "journal"), "utf8")).toBe("");
    expect(f.write.release).toHaveBeenCalledWith(true);
  });
  it("busy sessions refuse without unlocking a peer", async () => {
    const f = fixture(), plan = await f.census(), original = f.write.query.getMockImplementation()!;
    f.write.query.mockImplementation(async sql => sql.includes("pg_try_advisory_lock") ? { rows: [{ ok: false }] } : original(sql));
    await expect(f.execute(plan)).rejects.toThrow("candidate_index_catchup_refused");
    expect(f.write.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
    expect(f.write.release).toHaveBeenCalledWith(false);
  });
  it("plans use exclusive create; private files reject symlinks and unsafe modes", async () => {
    const f = fixture(), plan = await f.census(), path = join(directory, "plan");
    await saveApplicationCatchupPlan(path, plan, secret);
    await expect(saveApplicationCatchupPlan(path, plan, secret)).rejects.toThrow();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(plan);
    symlinkSync(path, join(directory, "journal")); await expect(f.execute(plan)).rejects.toThrow("candidate_index_catchup_refused");
    rmSync(join(directory, "journal")); writeFileSync(join(directory, "journal"), "", { mode: 0o600 });
    chmodSync(join(directory, "journal"), 0o644); await expect(f.execute(plan)).rejects.toThrow("candidate_index_catchup_refused");
  });
  it("raw database failures are not returned with sensitive messages", async () => {
    const f = fixture(); f.read.query.mockRejectedValue(Error("connection-private-sentinel"));
    await expect(f.census()).rejects.toThrow(/^candidate_index_catchup_refused$/);
    expect(f.read.release).toHaveBeenCalledWith(true);
  });
});
describe("legacy worker session fence", () => {
  const env = { FLOW_CANDIDATE_INDEX_MODE: "private_primary" };
  function connection() {
    const client = Object.assign(new EventEmitter(), {
      query: vi.fn(async (sql: string, _values?: unknown[]) => ({ rows: sql.includes("pg_try_advisory_lock")
        ? [{ acquired: true }] : sql.includes("pg_advisory_unlock") ? [{ released: true }] : [{ managed: false }] })),
      release: vi.fn(),
    });
    return { client, pool: { connect: vi.fn(async () => client) } };
  }
  it("checks before work and every supplied dispatch point; releases exactly the acquired lock", async () => {
    const { client, pool } = connection();
    const work = vi.fn(async check => { await check(); return 7; });
    expect(await withLegacyCandidateIndexFence(17, 23, work, { env, pool })).toBe(7);
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      "SELECT pg_try_advisory_lock(hashtext('flow:candidate-index:legacy'),$1) AS acquired",
      "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed",
      "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed",
      "SELECT pg_advisory_unlock(hashtext('flow:candidate-index:legacy'),$1) AS released",
    ]);
    expect(client.query.mock.calls.map(([, values]) => values)).toEqual([[23], [17, 23], [17, 23], [23]]);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(client.listenerCount("error")).toBe(0);
  });
  it("absent mode retains legacy behavior without a pool; dual coordinates without suppressing", async () => {
    const { client, pool } = connection();
    const work = vi.fn(async check => { await check(); });
    await withLegacyCandidateIndexFence(17, 23, work, { env: {}, pool });
    expect(pool.connect).not.toHaveBeenCalled();
    await withLegacyCandidateIndexFence(17, 23, work, { env: { FLOW_CANDIDATE_INDEX_MODE: "dual" }, pool });
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query.mock.calls.every(([sql]) => sql.includes("advisory"))).toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });
  it("a busy contender cannot dispatch or unlock a peer's session", async () => {
    const { client, pool } = connection();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    const work = vi.fn();
    await expect(withLegacyCandidateIndexFence(17, 23, work, { env, pool })).rejects.toMatchObject({ code: "busy" });
    expect(work).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it("a managed application never enters legacy work", async () => {
    const { client, pool } = connection();
    client.query.mockResolvedValueOnce({ rows: [{ acquired: true }] }).mockResolvedValueOnce({ rows: [{ managed: true }] });
    const work = vi.fn();
    await expect(withLegacyCandidateIndexFence(17, 23, work, { env, pool })).rejects.toMatchObject({ code: "managed" });
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it.each(["throw", "unknown"])("destroys a session after %s acquisition outcome", async mode => {
    const { client, pool } = connection();
    if (mode === "throw") client.query.mockRejectedValueOnce(Error("private-sentinel"));
    else client.query.mockResolvedValueOnce({ rows: [] });
    const work = vi.fn();
    await expect(withLegacyCandidateIndexFence(17, 23, work, { env, pool }))
      .rejects.toMatchObject({ code: "unavailable", message: "candidate_index_legacy_unavailable" });
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("connection loss during an awaited operation refuses the next dispatch and destroys the client", async () => {
    const { client, pool } = connection();
    const send = vi.fn();
    await expect(withLegacyCandidateIndexFence(17, 23, async check => {
      client.emit("error", Error("private-sentinel"));
      await check(); await send();
    }, { env, pool })).rejects.toMatchObject({ code: "unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it.each(["throw", "unknown"])("destroys a session after %s unlock outcome", async mode => {
    const { client, pool } = connection();
    await withLegacyCandidateIndexFence(17, 23, async () => {
      if (mode === "throw") client.query.mockRejectedValueOnce(Error("private-sentinel"));
      else client.query.mockResolvedValueOnce({ rows: [] });
    }, { env, pool });
    expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("preserves work failure while releasing the lock", async () => {
    const { client, pool } = connection();
    const failure = Error("synthetic-work-failure");
    await expect(withLegacyCandidateIndexFence(17, 23, async () => { throw failure; }, { env, pool })).rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledExactlyOnceWith(false);
  });
});
describe("adopted-only public application cutover", () => {
  const primary = { FLOW_CANDIDATE_INDEX_MODE: "private_primary" };
  it.each([{}, { FLOW_CANDIDATE_INDEX_MODE: "dual" }])("legacy/dual retains the bridge without a DB read", async env => {
    const db = { query: vi.fn() };
    expect(await shouldEnqueueLegacyApplication(17, 23, { env, db })).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([true, false])("uses the authoritative exact tuple: managed %s", async managed => {
    const db = { query: vi.fn(async () => ({ rows: [{ managed }] })) };
    expect(await shouldEnqueueLegacyApplication(17, 23, { env: primary, db })).toBe(!managed);
    expect(db.query).toHaveBeenCalledExactlyOnceWith(
      "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed", [17, 23]);
  });
  it.each([[], [{ managed: "false" }], [{ managed: null }], [{ managed: true }, { managed: false }]])(
    "invalid database authority is unavailable, never unmanaged", async rows => {
      const db = { query: vi.fn(async () => ({ rows })) };
      await expect(applicationUsesPrivateIndex(17, 23, { env: primary, db }))
        .rejects.toThrow("CANDIDATE_INDEX_LEGACY_GATE_UNAVAILABLE");
    });
  it.each([0, -1, 1.5, NaN, 2_147_483_648])("refuses invalid tuple %s before querying", async value => {
    const db = { query: vi.fn() };
    await expect(applicationUsesPrivateIndex(value, 23, { env: primary, db })).rejects.toThrow();
    await expect(applicationUsesPrivateIndex(17, value, { env: primary, db })).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
  it("the post-commit predicate contains unknown mode and query errors without leaking values", async () => {
    const db = { query: vi.fn(async () => { throw Error("private-db-sentinel@example.invalid"); }) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await shouldEnqueueLegacyApplication(17, 23, { env: primary, db })).toBe(false);
      expect(await shouldEnqueueLegacyApplication(17, 23, {
        env: { FLOW_CANDIDATE_INDEX_MODE: "unknown" }, db,
      })).toBe(false);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls).toEqual(Array(2).fill([
        "[ACTIVEKG_SYNC] Legacy adoption check unavailable (non-blocking)",
      ]));
    } finally { warn.mockRestore(); }
  });
});
const ref = "11111111-1111-4111-8111-111111111111";
const resume = "22222222-2222-4222-8222-222222222222";
const outbox = "33333333-3333-4333-8333-333333333333";
const source = "44444444-4444-4444-8444-444444444444";
const tenant = "org_17";
let privateKey: string;
let publicKey: Awaited<ReturnType<typeof importSPKI>>;
function command(): CandidateIndexEnvelope {
  const content = "Python database engineering";
  const identity = { tenant, referenceId: ref, resumeVersionId: resume, sourceVersion: 1,
    contentSha256: "a".repeat(64), contentKind: "pinned_text" as const, payloadSha256: sha(content) };
  return { schema_version: 1, reference_id: ref, resume_version_id: resume, application_id: 2001,
    job_id: 1001, source_version: 1, content_sha256: identity.contentSha256, byte_count: 12,
    media_type: "application/pdf", source_observed_at: "2026-09-14T00:00:00.000Z",
    captured_at: "2026-09-14T00:00:00.000Z", content_kind: "pinned_text", payload_sha256: sha(content),
    content, idempotency_key: candidateIndexCommandKey(identity),
    privacy_subject: [{ identifier_type: "vantahire_application_id", value: "2001" }] };
}
function receipt(envelope = command()) {
  return { outcome: "accepted", idempotency_key: envelope.idempotency_key,
    command_digest: candidateIndexCommandDigest(envelope, tenant), reference_id: ref,
    resume_version_id: resume, source_id: source };
}
const response = (body: unknown, status = 201) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

const bytes = Buffer.from("%PDF-1.7\nfixture private source\n%%EOF\n");
const storageInput = { locator: "gs://index-fixture/resumes/owned.pdf", byteCount: bytes.length,
  contentSha256: sha(bytes.toString()), mediaType: "application/pdf" };
describe("bounded frozen storage downloader", () => {
  let scratch: string;
  let artifact: string;
  const env = (mode = "success") => ({ GCS_PROJECT_ID: mode, GCS_BUCKET_NAME: "index-fixture",
    GCS_SERVICE_ACCOUNT_KEY: "{}", DATABASE_URL: "DO_NOT_COPY", GROQ_API_KEY: "DO_NOT_COPY",
    NODE_OPTIONS: "DO_NOT_COPY", HTTPS_PROXY: "DO_NOT_COPY" });
  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "flow-index-storage-"));
    symlinkSync(resolve("node_modules"), join(scratch, "node_modules"), "dir");
    const sdk = join(scratch, "synthetic-sdk.cjs");
    writeFileSync(sdk, `exports.Storage = class {
      constructor() {
        for (const name of ['DATABASE_URL','GROQ_API_KEY','NODE_OPTIONS','HTTPS_PROXY']) {
          if (process.env[name]) throw Error('credential inheritance');
        }
        console.log('DO_NOT_PRINT_BUCKET_OR_IDENTITY');
      }
      bucket(name) {
        if (name !== 'index-fixture') throw Error('wrong bucket');
        return { file: object => ({ download: async () => {
          if (object !== 'resumes/owned.pdf') throw Error('wrong object');
          if (process.env.GCS_PROJECT_ID === 'hang') await new Promise(r => setTimeout(r, 60000));
          if (process.env.GCS_PROJECT_ID === 'oom') return [Buffer.alloc(512 * 1024 * 1024)];
          if (process.env.GCS_PROJECT_ID === 'error') throw Error('DO_NOT_PRINT_CREDENTIAL');
          return [Buffer.from('${bytes.toString("base64")}', 'base64')];
        } }) };
      }
    };`);
    artifact = join(scratch, "candidate-index-gcs.cjs");
    await build({ entryPoints: ["server/gcs-storage.ts"], bundle: true, platform: "node",
      packages: "external", format: "cjs", alias: { "@google-cloud/storage": sdk }, outfile: artifact });
  });
  afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });
  it("calls the real frozen downloader under kernel limits and copies only storage credentials", async () => {
    expect(await downloadCandidateIndexOriginal(storageInput, {
      signal: new AbortController().signal, env: env(), artifact,
    })).toEqual(bytes);
  });
  it.each([
    { byteCount: bytes.length + 1 }, { contentSha256: "0".repeat(64) },
    { mediaType: "application/msword" }, { locator: "gs://other-bucket/resumes/owned.pdf" },
  ])("refuses changed object evidence %j without returning bytes", async delta => {
    await expect(downloadCandidateIndexOriginal({ ...storageInput, ...delta }, {
      signal: new AbortController().signal, env: env(), artifact,
    })).rejects.toBeInstanceOf(CandidateIndexMemoryError);
  });
  it.each(["error", "oom"])("keeps %s failures bounded and source-free", async mode => {
    await expect(downloadCandidateIndexOriginal(storageInput, {
      signal: new AbortController().signal, env: env(mode), artifact,
    })).rejects.toMatchObject({ message: "network", code: "network" });
  });
  it.each([false, true])("kills and reaps a child on timeout/cancellation (cancel=%s)", async cancel => {
    let pid: number | undefined;
    const launch: typeof spawn = ((...args: any[]) => {
      const child = (spawn as any)(...args); pid = child.pid; return child;
    }) as typeof spawn;
    const controller = new AbortController();
    const promise = downloadCandidateIndexOriginal(storageInput, { signal: controller.signal,
      env: env("hang"), artifact, launch, timeoutMs: cancel ? 20000 : 200 });
    const rejection = expect(promise).rejects.toMatchObject({ code: "timeout" });
    if (cancel) controller.abort();
    await rejection;
    expect(pid).toBeDefined();
    expect(() => process.kill(pid!, 0)).toThrow();
  });
  it("makes no child for pre-cancelled or missing configuration", async () => {
    const launch = vi.fn();
    await expect(downloadCandidateIndexOriginal(storageInput, {
      signal: AbortSignal.abort(), env: env(), artifact, launch,
    })).rejects.toThrow("timeout");
    await expect(downloadCandidateIndexOriginal(storageInput, {
      signal: new AbortController().signal, env: {}, artifact, launch,
    })).rejects.toThrow("network");
    expect(launch).not.toHaveBeenCalled();
  });
});

const config = { mode: "dual" as const, timeoutMs: 10000, leaseMs: 60000, pollMs: 1000, claimLimit: 8 };
function processorFixture(original = false) {
  const envelope = command();
  if (original) {
    Object.assign(envelope, { content: bytes.toString("base64"), content_kind: "original_bytes",
      content_sha256: storageInput.contentSha256, payload_sha256: storageInput.contentSha256,
      byte_count: bytes.length });
    envelope.idempotency_key = candidateIndexCommandKey({ tenant, referenceId: ref,
      resumeVersionId: resume, sourceVersion: 1, contentSha256: envelope.content_sha256,
      contentKind: envelope.content_kind, payloadSha256: envelope.payload_sha256 });
  }
  const claim = { outbox_id: outbox, organization_id: 17, application_id: 2001, job_id: 1001,
    reference_id: ref, resume_version_id: resume, source_version: 1, content_sha256: envelope.content_sha256,
    content_kind: envelope.content_kind, payload_sha256: envelope.payload_sha256,
    idempotency_key: envelope.idempotency_key, attempt: 1, generation: "2",
    lease_token: "55555555-5555-4555-8555-555555555555", lease_expires_at: new Date(Date.now() + 60000) };
  const evidence = { gcs_locator: storageInput.locator, content_sha256: envelope.content_sha256,
    byte_count: envelope.byte_count, media_type: envelope.media_type,
    extracted_text: original ? null : envelope.content, extracted_text_sha256: original ? null : envelope.payload_sha256,
    source_resume_id: null, source_observed_at: new Date(envelope.source_observed_at),
    captured_at: new Date(envelope.captured_at), email: "fixture@example.invalid", phone: null };
  const events: string[] = [];
  let claimed = false;
  const db = { query: vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("flow_claim_")) {
      events.push("claim"); expect(values).toEqual([1, config.leaseMs]);
      if (claimed) return { rows: [] }; claimed = true; return { rows: [claim] };
    }
    if (sql.includes("SELECT r.gcs_locator")) {
      events.push("source");
      expect(sql).not.toContain("organization_candidate_memory_outbox");
      expect(sql).toContain("j.organization_id=r.organization_id");
      expect(values).toEqual([resume, ref, 17, 2001, 1001, 1]);
      return { rows: [evidence] };
    }
    if (sql.includes("flow_ack_")) events.push("ack");
    else if (sql.includes("flow_fail_")) events.push("fail");
    else throw Error("unexpected SQL");
    return { rows: [{ accepted: true, failed: true }] };
  }) };
  const admit = vi.fn(async () => { events.push("privacy"); });
  const download = vi.fn(async () => { events.push("storage"); return bytes; });
  const deliver = vi.fn(async (input: Parameters<typeof deliverCandidateIndex>[0]) => {
    await input.beforeAttempt(); events.push("http");
    expect(input.envelope.privacy_subject).toEqual([
      { identifier_type: "vantahire_application_id", value: "2001" },
      { identifier_type: "email", value: "fixture@example.invalid" },
    ]);
    expect(JSON.stringify(input.envelope)).not.toContain("gs://");
    return { ...receipt(input.envelope), outcome: "accepted" as const };
  });
  return { claim, evidence, events, db, admit, download, deliver };
}
describe("private source processor", () => {
  it.each([false, true])("fences the whole source/privacy/storage/HTTP/ack path (bytes=%s)", async original => {
    const f = processorFixture(original);
    expect(await runCandidateIndexProcessorOnce(config, f)).toBe(1);
    expect(f.events).toEqual(["claim", "source", "privacy", ...(original ? ["storage"] : []),
      "source", "privacy", "http", "ack", "claim"]);
    const ack = f.db.query.mock.calls.find(([sql]) => sql.includes("flow_ack_"))![1];
    expect(ack?.slice(0, 7)).toEqual([outbox, f.claim.lease_token, 2, f.claim.idempotency_key,
      ref, resume, f.claim.payload_sha256]);
  });
  it("disabled mode does not touch the database", async () => {
    const f = processorFixture();
    expect(await runCandidateIndexProcessorOnce({ ...config, mode: null }, f)).toBe(0);
    expect(f.db.query).not.toHaveBeenCalled();
  });
  it.each(["candidate_privacy_restricted", "candidate_privacy_review_required", "candidate_privacy_unavailable"] as const)(
    "fails closed on %s before storage and delivery", async code => {
      const f = processorFixture(true);
      f.admit.mockRejectedValue(new CandidatePrivacyRestrictedError(code));
      await runCandidateIndexProcessorOnce(config, f);
      expect(f.events).toEqual(["claim", "source", "fail", "claim"]);
      expect(f.download).not.toHaveBeenCalled(); expect(f.deliver).not.toHaveBeenCalled();
      expect(f.db.query.mock.calls.find(([s]) => s.includes("flow_fail_"))![1]?.[3])
        .toBe(code === "candidate_privacy_restricted" ? "privacy_restricted" : "privacy_unavailable");
    });
  it("privacy changes during storage prevent HTTP and acknowledgement", async () => {
    const f = processorFixture(true);
    f.admit.mockImplementationOnce(async () => { f.events.push("privacy"); })
      .mockRejectedValue(new CandidatePrivacyRestrictedError("candidate_privacy_restricted"));
    await runCandidateIndexProcessorOnce(config, f);
    expect(f.events).toEqual(["claim", "source", "privacy", "storage", "source", "fail", "claim"]);
  });
  it.each(["content_sha256", "extracted_text_sha256", "extracted_text"])("refuses mismatched %s", async field => {
    const f = processorFixture();
    (f.evidence as any)[field] = "wrong";
    await runCandidateIndexProcessorOnce(config, f);
    expect(f.deliver).not.toHaveBeenCalled();
    expect(f.db.query.mock.calls.find(([s]) => s.includes("flow_fail_"))![1]?.[3]).toBe("source_mismatch");
  });
  it("cancellation after possible delivery retains ambiguity and never acknowledges", async () => {
    const f = processorFixture(); const controller = new AbortController();
    f.deliver.mockImplementation(async input => { await input.beforeAttempt(); controller.abort(); return receipt(input.envelope) as any; });
    await runCandidateIndexProcessorOnce(config, { ...f, signal: controller.signal });
    expect(f.events).not.toContain("ack"); expect(f.events).not.toContain("fail");
  });
  it("a forged database claim stops before any content lookup", async () => {
    const f = processorFixture(); f.claim.generation = "02";
    await expect(runCandidateIndexProcessorOnce(config, f)).rejects.toThrow("CANDIDATE_INDEX_CLAIM_INVALID");
    expect(f.events).toEqual(["claim"]);
  });
  it("joins the current tick on stop and never overlaps interval claims", async () => {
    vi.useFakeTimers();
    try {
      const { pool } = await import("../../db");
      let release!: () => void;
      vi.mocked(pool.query).mockImplementationOnce(() => new Promise<any>(resolve => {
        release = () => resolve({ rows: [] });
      }) as any);
      const stop = startCandidateIndexProcessor(config);
      await vi.advanceTimersByTimeAsync(10000);
      expect(pool.query).toHaveBeenCalledTimes(1);
      let stopped = false;
      const pending = stop().then(() => { stopped = true; });
      await Promise.resolve(); expect(stopped).toBe(false);
      release(); await pending;
      await vi.advanceTimersByTimeAsync(10000);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); vi.clearAllMocks(); }
  });
  it("requires the storage configuration only when the web lane is enabled", () => {
    expect(candidateIndexProcessorConfig({}).mode).toBeNull();
    expect(() => candidateIndexProcessorConfig({ FLOW_CANDIDATE_INDEX_MODE: "dual",
      ACTIVEKG_BASE_URL: "https://memory.example.invalid", VANTAHIRE_JWT_PRIVATE_KEY: "synthetic",
      VANTAHIRE_JWT_ACTIVE_KID: "synthetic" })).toThrow("CANDIDATE_INDEX_STORAGE_CHILD_UNAVAILABLE");
  });
});

describe("actual AI worker startup placement", () => {
  let program: string;
  beforeAll(async () => {
    const entry = resolve("server/aiWorker.ts");
    const source = ts.createSourceFile(entry, readFileSync(entry, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = new Map<string, string[]>();
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const names = statement.importClause?.namedBindings;
      imports.set(statement.moduleSpecifier.text, [...new Set([
        ...(imports.get(statement.moduleSpecifier.text) ?? []),
        ...(names && ts.isNamedImports(names) ? names.elements.map(item => (item.propertyName ?? item.name).text) : []),
      ])]);
    }
    // Compile the entire real entrypoint and real index contract. Only its
    // dependency boundaries are intercepted; main() and its ordering are real.
    const result = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs",
      write: false, plugins: [{ name: "startup-boundaries", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => args.importer === entry
          && args.path !== "./candidate-index/contracts" ? { path: args.path, namespace: "boundary" } : undefined);
        builder.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents:
          (imports.get(args.path) ?? []).map(name =>
            `export const ${name} = globalThis.__indexBoundaries.${name};`).join("\n"), loader: "js" }));
      } }] });
    program = result.outputFiles[0].text;
  });
  async function startup(value?: string) {
    const events: string[] = []; const exits: number[] = []; const errors: string[] = [];
    const boundaries = {
      pool: { end: async () => { events.push("pool-end"); } },
      Worker: class { constructor() { events.push("worker"); } on() { return this; } },
      getIoRedisConnection: () => { events.push("queue-connection"); return {}; },
      assertCandidatePrivacyRuntimeConfig: () => { events.push("privacy-config"); },
      assertDecisionProjectionDeliveryRuntimeConfig: () => { events.push("decision-config"); },
      QUEUES: { INTERACTIVE: "synthetic-interactive", BATCH: "synthetic-batch" },
      isSourcingRefreshQueueAvailable: () => false,
      startDecisionProjectionProcessor: () => { events.push("decision-processor"); },
    };
    runInNewContext(program, { require: createRequire(import.meta.url), __indexBoundaries: boundaries,
      process: { env: value === undefined ? {} : { FLOW_CANDIDATE_INDEX_MODE: value }, on() {},
        exit(code: number) { exits.push(code); } },
      console: { log() {}, error(_label: string, error: Error) { errors.push(error.message); } },
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    return { events, exits, errors };
  }
  it.each(["dual", "private_primary", "false", "", "garbage"])("refuses %j before a queue or worker starts", async value => {
    expect(await startup(value)).toEqual({ events: ["pool-end"], exits: [1],
      errors: ["CANDIDATE_INDEX_AI_FLAG_FORBIDDEN"] });
  });
  it("absence preserves the existing AI and decision startup path", async () => {
    expect(await startup()).toEqual({ events: ["privacy-config", "decision-config", "queue-connection",
      "worker", "worker", "decision-processor"], exits: [], errors: [] });
  });
});
const send = (fetchImpl: typeof fetch, changes: Partial<Parameters<typeof deliverCandidateIndex>[0]> = {}) =>
  deliverCandidateIndex({ envelope: command(), organizationId: 17, outboxId: outbox,
    beforeAttempt: async () => undefined, timeoutMs: 5000, fetchImpl, ...changes });

describe("candidate index delivery transport", () => {
  beforeAll(async () => {
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    privateKey = keys.privateKey;
    publicKey = await importSPKI(keys.publicKey, "RS256");
  });
  beforeEach(() => {
    vi.stubEnv("VANTAHIRE_JWT_PRIVATE_KEY", privateKey);
    vi.stubEnv("VANTAHIRE_JWT_ACTIVE_KID", "index-test");
    vi.stubEnv("ACTIVEKG_BASE_URL", "https://memory.example.invalid");
    clearKeyCache();
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); clearKeyCache(); });

  it("pins the whole-command digest to the same literal as Memory", () => {
    expect(candidateIndexCommandDigest(command(), tenant))
      .toBe("014f6f92fed28bb3280424f45684e6b3ed6fbddcdaabc66a59e658c0987fb0f3");
    expect(candidateIndexCommandDigest({ ...command(), privacy_subject: [
      ...command().privacy_subject, { identifier_type: "email", value: "fixture@example.invalid" },
    ] }, tenant)).toBe(candidateIndexCommandDigest(command(), tenant));
    for (const delta of [{ job_id: 1002 }, { byte_count: 13 },
      { captured_at: "2026-09-14T00:00:01.000Z" }]) {
      expect(candidateIndexCommandDigest({ ...command(), ...delta }, tenant))
        .not.toBe(candidateIndexCommandDigest(command(), tenant));
    }
  });

  it("uses the real signer and immediate proof, binds every receipt field and reports only acceptance", async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      order.push("http");
      expect(url).toBe("https://memory.example.invalid/organization-candidates/source-content");
      expect(init?.redirect).toBe("error");
      const token = new Headers(init?.headers).get("authorization")!.slice(7);
      const { payload } = await jwtVerify(token, publicKey, { issuer: "vantahire", audience: "activekg" });
      expect(payload).toMatchObject({ sub: "vantahire-backend", actor_type: "service", tenant_id: tenant,
        scopes: "organization-candidate-source:write", request_id: outbox });
      expect(JSON.parse(String(init?.body))).toEqual(command());
      return response(receipt());
    });
    expect(await send(fetcher, { beforeAttempt: async () => { order.push("privacy"); } })).toEqual(receipt());
    expect(order).toEqual(["privacy", "http"]);
    expect(await send(async () => response({ ...receipt(), outcome: "replayed" }, 200)))
      .toMatchObject({ outcome: "replayed" });
  });
  it.each(["idempotency_key", "command_digest", "reference_id", "resume_version_id", "source_id", "outcome"])(
    "refuses a mismatched or malformed %s", async (field) => {
      await expect(send(async () => response({ ...receipt(), [field]: "wrong" })))
        .rejects.toMatchObject({ code: "response_mismatch" });
    });
  it("does not reinterpret accepted as indexed or tolerate extra response data", async () => {
    await expect(send(async () => response({ ...receipt(), indexed: true }))).rejects.toThrow("response_mismatch");
    await expect(send(async () => response({ ...receipt(), outcome: "replayed" }))).rejects.toThrow("response_mismatch");
  });
  it.each([[408, "receiver_unavailable"], [425, "receiver_unavailable"], [429, "rate_limited"],
    [500, "receiver_unavailable"], [503, "receiver_unavailable"], [401, "receiver_rejected"],
    [403, "receiver_rejected"], [409, "receiver_rejected"], [422, "receiver_rejected"],
    [451, "privacy_restricted"], [302, "receiver_rejected"]] as const)("classifies %s without reading an error body", async (status, code) => {
    await expect(send(async () => response({ private: "never-reflected" }, status))).rejects.toMatchObject({ code });
  });
  it("never calls Memory after a privacy refusal, cancellation or malformed source", async () => {
    const fetcher = vi.fn();
    await expect(send(fetcher, { beforeAttempt: async () => { throw new CandidateIndexMemoryError("privacy_unavailable"); } }))
      .rejects.toThrow("privacy_unavailable");
    await expect(send(fetcher, { signal: AbortSignal.abort() })).rejects.toThrow("timeout");
    await expect(send(fetcher, { envelope: { ...command(), content: "changed" } })).rejects.toThrow("source_mismatch");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds a chunked body before concatenation and cancels the stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(32 * 1024)); },
      cancel() { cancelled = true; },
    });
    await expect(send(async () => new Response(body, { status: 201,
      headers: { "content-type": "application/json" } }))).rejects.toThrow("response_mismatch");
    expect(cancelled).toBe(true);
  });
  it("enforces the same attempt deadline during a stalled response body", async () => {
    let cancelled = false;
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      status: 201, headers: { "content-type": "application/json" },
    }));
    await expect(send(fetcher, { timeoutMs: 40 })).rejects.toThrow("timeout");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
  });
  it.each(["http://memory.example.invalid", "https://user:secret@memory.example.invalid", "https://memory.example.invalid/path",
    "https://memory.example.invalid?secret=x", "file:///private"])("refuses unsafe origins without any request", async (url) => {
      vi.stubEnv("ACTIVEKG_BASE_URL", url);
      const fetcher = vi.fn();
      await expect(send(fetcher)).rejects.toThrow("network");
      expect(fetcher).not.toHaveBeenCalled();
    });
  it("requires verified HTTPS in production, permits only loopback HTTP for disposable tests", async () => {
    vi.stubEnv("ACTIVEKG_BASE_URL", "http://127.0.0.1:9123");
    expect(await send(async () => response(receipt()))).toMatchObject({ outcome: "accepted" });
    vi.stubEnv("NODE_ENV", "production");
    await expect(send(vi.fn())).rejects.toThrow("network");
  });
  it("rejects URLs, duplicate privacy input, invalid UTF-8 and noncanonical base64 at source validation", () => {
    for (const bad of [{ ...command(), locator: "gs://fixture/private" },
      { ...command(), privacy_subject: [command().privacy_subject[0], command().privacy_subject[0]] },
      { ...command(), content: "\ud800", payload_sha256: sha("\ud800") }]) {
      expect(() => validateCandidateIndexEnvelope(bad, tenant)).toThrow("source_mismatch");
    }
    const bytes = Buffer.from("%PDF-fixture");
    const good = { ...command(), content: bytes.toString("base64"), content_kind: "original_bytes" as const,
      byte_count: bytes.length, content_sha256: sha(bytes.toString()), payload_sha256: sha(bytes.toString()) };
    good.idempotency_key = candidateIndexCommandKey({ tenant, referenceId: ref, resumeVersionId: resume,
      sourceVersion: 1, contentSha256: good.content_sha256, contentKind: good.content_kind, payloadSha256: good.payload_sha256 });
    expect(validateCandidateIndexEnvelope(good, tenant)).toEqual(good);
    expect(() => validateCandidateIndexEnvelope({ ...good, content: good.content + "\n" }, tenant)).toThrow("source_mismatch");
  });
});
