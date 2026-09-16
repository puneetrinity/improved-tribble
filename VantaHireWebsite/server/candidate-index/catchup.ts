// Explicit local operations only. No CLI auto-run, HTTP registration, timer,
// provider request, historical sweep or implicit production credential lookup.
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { CandidatePrivacyRestrictedError } from "../candidate-privacy/decision";
import { requireOrganizationCandidateApplicationAllowed } from "../organization-candidates/application-intake";
import { candidateIndexMode } from "./contracts";
import { downloadCandidateIndexOriginal } from "./processor";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const positive = z.number().int().positive().max(2_147_483_647);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const zero = "00000000-0000-0000-0000-000000000000";
export const CATCHUP_ATTEMPTS_PER_SOURCE = 5; // SQL hard ceilings: extract2 + embed3, never customer credits.

export const catchupPostureSchema = z.object({
  flowTarget: z.string().min(1).max(200), memoryTarget: z.string().min(1).max(200),
  flowTree: z.string().regex(/^[0-9a-f]{40}$/), memoryTree: z.string().regex(/^[0-9a-f]{40}$/),
  legacyWorkerTree: z.string().regex(/^[0-9a-f]{40}$/), policySha256: digest,
  mode: z.literal("private_primary"), running: z.literal(true),
}).strict().refine(p => p.flowTree === p.legacyWorkerTree);
export type CatchupPosture = z.infer<typeof catchupPostureSchema>;
const entrySchema = z.object({ sourceId: uuid, referenceId: uuid, organizationId: positive,
  fingerprint: digest, authoritySha256: digest }).strict();
const reasonSchema = z.enum(["source_orphaned", "binding_ambiguous", "source_mismatch", "intake_unacknowledged",
  "already_managed", "legacy_busy", "legacy_uncertain", "object_unavailable", "privacy_restricted", "privacy_unavailable"]);
export type CatchupSkip = z.infer<typeof reasonSchema>;
const outcomeSchema = z.enum([...reasonSchema.options, "captured"]);
const bodySchema = z.object({ version: z.literal(1), kind: z.literal("flow_application_catchup"), nonce: uuid,
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  posture: catchupPostureSchema, cursor: uuid, nextCursor: uuid,
  maxRows: z.number().int().min(1).max(100), maxProviderAttempts: z.number().int().min(0).max(500),
  scanned: z.number().int().min(0).max(100), entries: z.array(entrySchema).max(100),
  skipped: z.record(reasonSchema, z.number().int().min(0).max(100)),
}).strict();
const planSchema = bodySchema.extend({ seal: digest });
export type ApplicationCatchupPlan = z.infer<typeof planSchema>;
type Entry = z.infer<typeof entrySchema>;
interface Connection {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
  release(destroy?: boolean): void;
  on(event: "error", listener: () => void): unknown;
  removeListener(event: "error", listener: () => void): unknown;
}
interface Pool { connect(): Promise<Connection>; }
export interface CatchupDependencies {
  // The approved operator adapter must freshly observe running, reviewed trees,
  // policy and flags; accepting a staged flag or a caller's unchecked JSON is not
  // an implementation of this interface. The release fixture supplies it later.
  readRunningPosture: () => Promise<CatchupPosture>;
  readPool: Pool;
  admit?: typeof requireOrganizationCandidateApplicationAllowed;
  download?: typeof downloadCandidateIndexOriginal;
  now?: () => number;
}
class Skip extends Error { constructor(readonly reason: CatchupSkip) { super(reason); } }
const refuse = (): never => { throw new Error("candidate_index_catchup_refused"); };
function mac(key: Buffer, value: unknown): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) return refuse();
  return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
}
function sameMac(left: string, right: string): boolean {
  return digest.safeParse(left).success && timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
function verifyPlan(value: unknown, key: Buffer, now: number): ApplicationCatchupPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) return refuse();
  const { seal, ...body } = parsed.data;
  if (!sameMac(seal, mac(key, body)) || body.issuedAt > now || body.expiresAt <= now
    || body.expiresAt <= body.issuedAt || body.expiresAt - body.issuedAt > 7_200_000
    || body.scanned > body.maxRows || body.entries.length > body.scanned
    || body.entries.length * CATCHUP_ATTEMPTS_PER_SOURCE > body.maxProviderAttempts
    || body.scanned !== body.entries.length + Object.values(body.skipped).reduce((a, b) => a + b, 0)
    || body.nextCursor < body.cursor || body.entries.some((e, i) => e.sourceId <= (body.entries[i - 1]?.sourceId ?? body.cursor)
      || e.sourceId > body.nextCursor)) return refuse();
  return parsed.data;
}

export const APPLICATION_CATCHUP_SQL = `SELECT r.*,a.id AS live_application,a.email,a.phone,
  j.id AS live_job,ref.origin_code,b.state AS intake_state,b.memory_candidate_id,
  g.status AS legacy_status,g.attempts AS legacy_attempts,
  (SELECT count(*)::int FROM public.organization_candidate_references x
    WHERE x.application_id=r.application_id) AS bindings,
  EXISTS(SELECT 1 FROM public.candidate_index_outbox i
    WHERE i.organization_id=r.organization_id AND i.application_id=r.application_id) AS managed
 FROM public.application_resume_versions r
 LEFT JOIN public.applications a ON a.id=r.application_id AND a.organization_id=r.organization_id AND a.job_id=r.job_id
 LEFT JOIN public.jobs j ON j.id=r.job_id AND j.organization_id=r.organization_id
 LEFT JOIN public.organization_candidate_references ref ON ref.reference_id=r.reference_id
   AND ref.organization_id=r.organization_id AND ref.application_id=r.application_id AND ref.job_id=r.job_id
 LEFT JOIN public.organization_candidate_memory_outbox b ON b.reference_id=r.reference_id AND b.resume_version_id=r.resume_version_id
   AND b.organization_id=r.organization_id AND b.application_id=r.application_id AND b.job_id=r.job_id
 LEFT JOIN public.application_graph_sync_jobs g ON g.application_id=r.application_id`;

async function target(client: Connection, expected: string) {
  const rows = (await client.query("SELECT target_id FROM schema_control.identity WHERE singleton=true")).rows;
  if (rows.length !== 1 || rows[0].target_id !== expected) refuse();
}
async function readRows(pool: Pool, posture: CatchupPosture, predicate: string, values: unknown[]) {
  const client = await pool.connect();
  let broken = false;
  const lost = () => { broken = true; };
  client.on("error", lost);
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='3s'");
    await target(client, posture.flowTarget);
    if ((await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only !== "on") refuse();
    const rows = (await client.query(APPLICATION_CATCHUP_SQL + predicate, values)).rows;
    await client.query("COMMIT");
    return rows;
  } finally {
    await client.query("ROLLBACK").catch(() => { broken = true; });
    client.removeListener("error", lost); client.release(broken);
  }
}
function identity(row: any): Entry {
  if (!row.live_application || !row.live_job || row.origin_code !== "candidate_applied") throw new Skip("source_orphaned");
  if (row.bindings !== 1) throw new Skip("binding_ambiguous");
  if (row.intake_state !== "acknowledged" || !uuid.safeParse(row.memory_candidate_id).success) throw new Skip("intake_unacknowledged");
  if (row.version !== 1 || !digest.safeParse(row.content_sha256).success
    || !Number.isInteger(row.byte_count) || row.byte_count < 1 || row.byte_count > 5 * 1024 * 1024
    || !["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(row.media_type)
    || typeof row.gcs_locator !== "string" || typeof row.email !== "string"
    || !(row.source_observed_at instanceof Date) || !(row.captured_at instanceof Date)
    || (row.extracted_text_sha256 !== null && (typeof row.extracted_text !== "string"
      || !row.extracted_text.length || row.extracted_text.includes("\u0000")
      || Buffer.byteLength(row.extracted_text) > 2 * 1024 * 1024 || hash(row.extracted_text) !== row.extracted_text_sha256))) throw new Skip("source_mismatch");
  const parsed = entrySchema.safeParse({ sourceId: row.resume_version_id, referenceId: row.reference_id,
    organizationId: row.organization_id, fingerprint: hash(JSON.stringify([row.reference_id, row.resume_version_id,
      row.organization_id, row.application_id, row.job_id, row.version, row.source_kind, row.source_resume_id,
      row.source_observed_at.toISOString(), row.captured_at.toISOString(), row.gcs_locator, row.content_sha256,
      row.byte_count, row.media_type, row.extracted_text_sha256])),
    authoritySha256: hash(JSON.stringify([row.application_id, row.organization_id, row.job_id,
      row.memory_candidate_id, row.email, row.phone])) });
  if (!parsed.success) throw new Skip("source_mismatch");
  return parsed.data;
}
async function eligible(row: any, deps: CatchupDependencies): Promise<Entry> {
  const entry = identity(row);
  if (row.managed === true) throw new Skip("already_managed");
  if (row.managed !== false) throw new Skip("binding_ambiguous");
  if (row.legacy_status !== null && !(row.legacy_status === "pending" && row.legacy_attempts === 0)
    && !(row.legacy_attempts === 1 && ["succeeded", "privacy_restricted"].includes(row.legacy_status))) {
    throw new Skip(row.legacy_status === "processing" ? "legacy_busy" : "legacy_uncertain");
  }
  try {
    await (deps.admit ?? requireOrganizationCandidateApplicationAllowed)({ applicationId: row.application_id, email: row.email, phone: row.phone });
  } catch (error) {
    throw new Skip(error instanceof CandidatePrivacyRestrictedError && error.code === "candidate_privacy_restricted"
      ? "privacy_restricted" : "privacy_unavailable");
  }
  try {
    const bytes = await (deps.download ?? downloadCandidateIndexOriginal)({ locator: row.gcs_locator,
      byteCount: row.byte_count, contentSha256: row.content_sha256, mediaType: row.media_type },
    { signal: AbortSignal.timeout(20_000) });
    if (bytes.length !== row.byte_count || hash(bytes) !== row.content_sha256) throw Error();
  } catch { throw new Skip("object_unavailable"); }
  return entry;
}

export async function censusApplicationCatchup(input: { cursor?: string; maxRows: number; maxProviderAttempts: number;
  lifetimeMs: number; key: Buffer }, deps: CatchupDependencies): Promise<ApplicationCatchupPlan> {
  try {
  const posture = catchupPostureSchema.parse(await deps.readRunningPosture());
  const start = (deps.now ?? Date.now)();
  const cursor = uuid.parse(input.cursor ?? zero);
  if (!Number.isInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100
    || !Number.isInteger(input.maxProviderAttempts) || input.maxProviderAttempts < 0 || input.maxProviderAttempts > 500
    || !Number.isInteger(input.lifetimeMs) || input.lifetimeMs < 1 || input.lifetimeMs > 7_200_000) return refuse();
  mac(input.key, null);
  const rows = await readRows(deps.readPool, posture,
    " WHERE r.resume_version_id>$1::uuid ORDER BY r.resume_version_id LIMIT $2", [cursor, input.maxRows]);
  const entries: Entry[] = [], skipped: Partial<Record<CatchupSkip, number>> = {};
  for (const row of rows) {
    try { entries.push(await eligible(row, deps)); }
    catch (error) { if (!(error instanceof Skip)) throw error; skipped[error.reason] = (skipped[error.reason] ?? 0) + 1; }
  }
  const body = bodySchema.parse({ version: 1, kind: "flow_application_catchup", nonce: randomUUID(), issuedAt: start,
    expiresAt: start + input.lifetimeMs, posture, cursor, nextCursor: rows.at(-1)?.resume_version_id ?? cursor,
    maxRows: input.maxRows, maxProviderAttempts: input.maxProviderAttempts, scanned: rows.length, entries, skipped });
  return verifyPlan({ ...body, seal: mac(input.key, body) }, input.key, (deps.now ?? Date.now)());
  } catch { return refuse(); }
}

async function syncParent(path: string) {
  const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}
async function privateFile(path: string, exclusive: boolean) {
  if (path !== resolve(path)) refuse();
  const parent = dirname(path), stat = await lstat(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700
    || stat.uid !== process.getuid?.() || await realpath(parent) !== parent) refuse();
  const handle = await open(path, constants.O_NOFOLLOW | constants.O_CREAT | constants.O_RDWR | constants.O_APPEND
    | (exclusive ? constants.O_EXCL : 0), 0o600);
  const info = await handle.stat();
  if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.nlink !== 1 || info.uid !== process.getuid?.() || info.size > 128_000) {
    await handle.close(); refuse();
  }
  return handle;
}
export async function saveApplicationCatchupPlan(path: string, plan: ApplicationCatchupPlan, key: Buffer) {
  verifyPlan(plan, key, Date.now());
  // Exclusive create: never overwrite an earlier sealed plan.
  const parent = await privateFile(path, true);
  try {
    if ((await parent.stat()).size !== 0) refuse();
    await parent.writeFile(JSON.stringify(plan)); await parent.sync();
    await syncParent(path);
  } finally { await parent.close(); }
}

export async function executeApplicationCatchup(input: { plan: unknown; key: Buffer; journalPath: string;
  writePool: Pool; operatorApproved: boolean }, deps: CatchupDependencies): Promise<Record<string, number>> {
  if (input.operatorApproved !== true || candidateIndexMode() !== "private_primary") return refuse();
  const now = deps.now ?? Date.now;
  const plan = verifyPlan(input.plan, input.key, now());
  const client = await input.writePool.connect();
  let locked = false, uncertain = true, broken = false;
  const lost = () => { broken = true; };
  const alive = () => { if (broken) refuse(); };
  client.on("error", lost);
  try {
    await target(client, plan.posture.flowTarget);
    const acquired = (await client.query("SELECT pg_try_advisory_lock(hashtext('flow:candidate-index:catchup'),hashtext($1)) AS ok", [plan.nonce])).rows[0]?.ok;
    if (acquired !== true) { uncertain = acquired !== false; return refuse(); }
    locked = true; uncertain = false;
    const journal = await privateFile(input.journalPath, false);
    try {
      const contents = await journal.readFile("utf8");
      // A kill can tear the final append. Authenticate every complete line first;
      // only the unfinished tail is recoverable. The committed database intent,
      // not an unsealed tail, decides whether that source must be skipped.
      const end = contents.lastIndexOf("\n") + 1;
      const prior = contents.slice(0, end).split("\n").filter(Boolean);
      let chain = plan.seal;
      const outcomes: Record<string, number> = {};
      const seen = new Set<string>();
      for (const [index, line] of prior.entries()) {
        const row = z.object({ seq: z.number().int(), sourceId: uuid, outcome: outcomeSchema, previous: digest, seal: digest }).strict().parse(JSON.parse(line));
        const { seal, ...body } = row;
        if (row.seq !== index || row.previous !== chain || !sameMac(seal, mac(input.key, body))
          || !plan.entries.some(e => e.sourceId === row.sourceId) || seen.has(row.sourceId)) refuse();
        chain = seal; seen.add(row.sourceId); outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
      }
      alive();
      if (end !== contents.length) await journal.truncate(Buffer.byteLength(contents.slice(0, end)));
      await journal.sync(); await syncParent(input.journalPath);
      for (const entry of plan.entries) {
        alive();
        verifyPlan(plan, input.key, now());
        if (JSON.stringify(catchupPostureSchema.parse(await deps.readRunningPosture())) !== JSON.stringify(plan.posture)) refuse();
        if (seen.has(entry.sourceId)) continue;
        let outcome: z.infer<typeof outcomeSchema> = "captured";
        try {
          const rows = await readRows(deps.readPool, plan.posture, " WHERE r.resume_version_id=$1::uuid", [entry.sourceId]);
          if (rows.length !== 1) throw new Skip(rows.length ? "binding_ambiguous" : "source_orphaned");
          if (JSON.stringify(identity(rows[0])) !== JSON.stringify(entry)) throw new Skip("source_mismatch");
          await eligible(rows[0], deps);
          // Slow storage checks occur outside the write transaction. Re-read the
          // exact tuple and privacy after that wait; dispatch also re-admits later.
          const current = await readRows(deps.readPool, plan.posture, " WHERE r.resume_version_id=$1::uuid", [entry.sourceId]);
          if (current.length !== 1 || JSON.stringify(identity(current[0])) !== JSON.stringify(entry)) throw new Skip("source_mismatch");
          try { await (deps.admit ?? requireOrganizationCandidateApplicationAllowed)({ applicationId: current[0].application_id,
            email: current[0].email, phone: current[0].phone }); }
          catch (error) { throw new Skip(error instanceof CandidatePrivacyRestrictedError && error.code === "candidate_privacy_restricted"
            ? "privacy_restricted" : "privacy_unavailable"); }
          verifyPlan(plan, input.key, now());
          alive();
          await client.query("BEGIN");
          try {
            const id = (await client.query("SELECT public.flow_capture_candidate_index_catchup($1,$2,$3) AS id",
              [entry.organizationId, entry.referenceId, entry.sourceId])).rows[0]?.id;
            if (!uuid.safeParse(id).success) refuse();
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            const code = (error as { code?: string }).code;
            if (code === "55P03") throw new Skip("legacy_busy");
            if (code === "22023") throw new Skip("legacy_uncertain");
            throw error;
          }
        } catch (error) { if (!(error instanceof Skip)) throw error; outcome = error.reason; }
        alive();
        const body = { seq: seen.size, sourceId: entry.sourceId, outcome, previous: chain };
        const row = { ...body, seal: mac(input.key, body) };
        await journal.writeFile(JSON.stringify(row) + "\n"); await journal.sync();
        chain = row.seal; seen.add(entry.sourceId); outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      return outcomes;
    } finally { await journal.close(); }
  } catch { throw new Error("candidate_index_catchup_refused"); }
  finally {
    if (locked) {
      try { uncertain = (await client.query("SELECT pg_advisory_unlock(hashtext('flow:candidate-index:catchup'),hashtext($1)) AS ok", [plan.nonce])).rows[0]?.ok !== true; }
      catch { uncertain = true; }
    }
    client.removeListener("error", lost); client.release(uncertain || broken);
  }
}
