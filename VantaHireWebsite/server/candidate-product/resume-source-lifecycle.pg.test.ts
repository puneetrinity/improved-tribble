import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runReleaseMigration, type MigrationClient } from '../schema-control/runner';
import { provisionRuntimeRole } from '../schema-control/runtimeRole';
import { runConsentV2Once } from './consent-v2';
import { canonicalProfileJson } from './profile-contracts';
import { sourceObjectDependencies, RESUME_SOURCE_RUNTIME_FUNCTIONS, SOURCE_OWNER_FUNCTIONS, SOURCE_RUNTIME_FUNCTIONS } from './source-repository';
import { sourcePrivilegesReady } from '../schema-control/readiness';
import { resumeSourceRepository, ResumeSourceRepositoryError, type Actor } from './resume-source-repository';
import { processResumeSource, type ResumeProcessorDependencies } from './resume-source-processor';
import { extractResumeSource } from './resume-source';
import { verifyStoredTransfer, type StoredTransfer } from './resume-source-client';

// P2 end-to-end on the full Flow schema (0026) with the real P0 routines, the real
// P2 repository/adapter/processor and a restricted runtime role. Only providers are
// faked: storage bytes, the model, the OCR result and the Memory receiver.
// Disposable local database only (same guard as spark-lifecycle.pg.test.ts).

const url = process.env.S2_FLOW_TEST_ADMIN_URL;
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const RESUME = 'Priya Rao\nSenior Backend Engineer\nSkills: Go, PostgreSQL, Kafka\nAcme Payments — Engineer, 2019 – Present';
const MODEL_JSON = JSON.stringify({ facts: [{ kind: 'skill', value: 'Kafka', evidence: [{ quote: 'Skills: Go, PostgreSQL, Kafka' }] }], notes: [] });
const docxBytes = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('synthetic word/document.xml')]);
const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('synthetic scanned pdf')]);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe.skipIf(!url)('P2 résumé pipeline on the full Flow schema and a restricted runtime', () => {
  let db: Client, app: Client, database: string, runtime: string, port: number;
  let repo: ReturnType<typeof resumeSourceRepository>, objects: ReturnType<typeof sourceObjectDependencies>;
  let user = 5000;
  const copy = 'a'.repeat(64), password = sha('synthetic');
  const blobs = new Map<string, Buffer>();
  const connect = async (role: string) => { const c = new Client({ host: '127.0.0.1', port, user: role, database }); await c.connect(); return c; };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.S2_PROTOTYPE_DISPOSABLE !== '1' || parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/postgres') throw Error('disposable_only');
    port = Number(parsed.port);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10), owner = `flow_schema_control_test_owner_${suffix}`;
    runtime = `flow_schema_control_test_runtime_${suffix}`; database = `flow_schema_control_test_${suffix}`;
    const admin = new Client({ connectionString: url }); await admin.connect();
    try {
      await admin.query(`CREATE ROLE ${owner} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE`);
      await admin.query(`CREATE DATABASE ${database} OWNER ${owner} TEMPLATE template0 ENCODING 'UTF8'`);
    } finally { await admin.end(); }
    const adapter = async (role: string): Promise<MigrationClient> => { const c = await connect(role); return { query: (q, p) => c.query(q, p as any), end: () => c.end() }; };
    const roleUrl = (role: string) => `postgresql://${role}:synthetic-local-only@127.0.0.1:${port}/${database}`;
    const target = 'p2-resume-' + suffix;
    const input = { migrationsDir: resolve('server/schema-migrations'), creds: { migrateUrl: roleUrl(owner), expectedTargetId: target,
      environment: 'development' as const, allowFreshInitialization: true }, connect: () => adapter(owner) };
    expect((await runReleaseMigration(input)).applied.length).toBeGreaterThan(0);
    await provisionRuntimeRole({ migrateUrl: roleUrl(owner), runtimeUrl: roleUrl(runtime), runtimeRole: runtime, expectedTargetId: target,
      connectMigration: () => adapter(owner), connectRuntime: () => adapter(runtime) });
    db = await connect(owner); app = await connect(runtime);
    // B2: no test-only grants. The runtime role has exactly what the real provisioner gives it.
    await db.query('INSERT INTO candidate_consent_v2_copies VALUES(2,$1,true)', [copy]);
    await db.query('UPDATE candidate_source_ai_policy SET enabled=true');
    await db.query("INSERT INTO candidate_source_ocr_prices VALUES('test-ocr',1500,'2020-01-01','2099-01-01','synthetic fixture')");
    await db.query("INSERT INTO candidate_source_ai_prices VALUES('resume-test-v1','synthetic-model',1,1,'2020-01-01','2099-01-01','Synthetic fixture only')");
    await db.query(`INSERT INTO candidate_source_budget_windows(kind,period,starts_at,ends_at,global_units,per_candidate_units)
      SELECT k,p,clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',1000000,1000000
      FROM unnest(ARRAY['ocr','semantic_model']) k CROSS JOIN unnest(ARRAY['day','month']) p`);
    repo = resumeSourceRepository(app, async () => {});
    objects = sourceObjectDependencies(app, async () => {}, {
      readBlob: (async (path: string, expected?: { generation: string; byteLength: number; contentHash: string }) => {
        const bytes = blobs.get(path); if (!bytes) throw Error('source_unavailable');
        if (expected && (expected.contentHash !== sha(bytes) || expected.byteLength !== bytes.length)) throw Error('source_changed');
        return { generation: '1', byteLength: bytes.length, contentHash: sha(bytes), bytes,
          mediaType: bytes.subarray(0, 5).toString() === '%PDF-' ? 'application/pdf' : DOCX };
      }) as never,
      readProfile: (async () => ({ draftVersion: 0, profileVersion: 0, preferenceVersion: 0, preferenceDraft: null })) as never,
    });
    console.log('Retained P2 résumé fixture', database);
  }, 90_000);
  afterEach(async () => {
    if (db) await db.query("UPDATE candidate_source_jobs SET state='held',reason='outcome_unknown',lease_token=NULL,lease_until=NULL WHERE state IN ('queued','extracting','building','transferring')");
  });
  afterAll(async () => {
    await app?.end(); await db?.end();
  });

  const email = (id: number) => `p2user${id}@example.invalid`;
  async function candidate(bytes: Buffer) {
    const id = ++user;
    await db.query("INSERT INTO users(id,username,password,role,email_verified,auth_version,first_name,last_name) VALUES($1,$2,'synthetic','candidate',true,1,'Synthetic','Resume')", [id, email(id)]);
    await app.query('SELECT flow_candidate_foundation_ensure($1,1,$2,clock_timestamp(),$3)', [id, password, randomUUID()]);
    await db.query("UPDATE candidate_product_accounts SET foundation_state='linked',acknowledged_sequence=command_sequence WHERE user_id=$1", [id]);
    const c = (await app.query('SELECT flow_consent_v2_capture_owned($1,1,$2,0,$3,2,$4) result', [id, randomUUID(), 'grant', copy])).rows[0].result;
    await runConsentV2Once({ db: app, workerId: 'p2-resume-consent', privacy: async () => 'allowed', deliver: async raw => {
      const x = JSON.parse(raw); return { eventId: x.eventId, version: x.version, effectiveVersion: x.version, outcome: 'onboarding_granted' };
    } }, c.eventId);
    const path = `resumes/${randomUUID()}${bytes === pdfBytes ? '.pdf' : '.docx'}`;
    blobs.set(path, bytes);
    const resumeId = (await db.query("INSERT INTO candidate_resumes(user_id,label,gcs_path,is_default) VALUES($1,'Synthetic',$2,false) RETURNING id", [id, path])).rows[0].id;
    const location = (await app.query('SELECT flow_candidate_source_locator($1,$2) result', [id, resumeId])).rows[0].result;
    const actor: Actor = { userId: id, subjectId: location.subjectId, bindingId: location.bindingId };
    return { actor, resumeId };
  }
  async function start(bytes: Buffer) {
    const c = await candidate(bytes);
    const snapshot = await objects.snapshot(c.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), resumeId: c.resumeId });
    const status = await repo.enqueue(c.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), sourceId: snapshot.sourceId, sourceVersion: snapshot.sourceVersion });
    return { ...c, snapshot, commandId: status.commandId };
  }
  async function claimFor(commandId: string) {
    for (let i = 0; i < 20; i++) {
      const claim = await repo.claim(randomUUID());
      if (!claim) break;
      if (claim.lease.commandId === commandId) return claim;
    }
    throw Error('claim_not_found');
  }
  const expireLease = (commandId: string) =>
    db.query("UPDATE candidate_source_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE command_id=$1", [commandId]);

  function deps(over: Partial<ResumeProcessorDependencies> & { inner?: 'native' | 'scanned' | 'ocr_fails' } = {}) {
    const calls = { model: 0, delivered: [] as StoredTransfer[] };
    const inner = over.inner === 'ocr_fails'
      ? (async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
          await opts.beforeOcr({ schemaVersion: 1, contentHash: sha(pdfBytes), totalPages: 2, pageNumbers: [1, 2] });
          return { success: false, text: '', method: 'none' as const, providerCalls: 1, reasonCode: 'OCR_TIMEOUT' as const };
        })
      : over.inner === 'scanned'
      ? (async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
          // Mixed 3-page PDF: only page 2 has no native text.
          await opts.beforeOcr({ schemaVersion: 1, contentHash: sha(pdfBytes), totalPages: 3, pageNumbers: [2] });
          return { success: true, text: RESUME, method: 'google_vision_ocr' as const, providerCalls: 1 };
        })
      : (async () => ({ success: true, text: RESUME, method: 'native_text' as const, providerCalls: 0 }));
    const base: ResumeProcessorDependencies = {
      // Same reader as production (server/index.ts passes the whole object dependency).
      repo, reader: { read: (a, s) => objects.read(a, s), saveLibraryText: (a, s, t) => objects.saveLibraryText(a, s, t) }, modelName: 'synthetic-model',
      extract: ((input: unknown, bytes: Buffer, d: Parameters<typeof extractResumeSource>[2]) =>
        extractResumeSource(input, bytes, { ...d, extract: inner as never })) as typeof extractResumeSource,
      model: async () => { calls.model++; return { content: MODEL_JSON, usage: { inputTokens: 50, outputTokens: 20 } }; },
      deliver: async (stored) => {
        calls.delivered.push(stored);
        const t = verifyStoredTransfer(stored);
        const receipt = { schemaVersion: 1 as const, commandId: t.commandId, subjectId: t.subjectId, bindingId: t.bindingId,
          commandHash: stored.sha256, sourceId: t.sourceId, sourceVersion: t.sourceVersion, proposalId: t.proposal.proposalId,
          proposalHash: t.proposal.proposalHash, outcome: 'stored' as const, reason: null, canonicalProfileChanged: false as const,
          publicationActive: false as const };
        const canonical = canonicalProfileJson(receipt);
        return { receipt, document: { canonical, sha256: sha(canonical) } };
      },
    };
    return { d: { ...base, ...over }, calls };
  }
  const rowsMentioning = async (needle: string) => {
    let n = 0;
    for (const table of ['candidate_source_objects', 'candidate_source_requests', 'candidate_source_jobs',
      'candidate_source_budget_windows', 'candidate_source_paid_operations'])
      n += Number((await db.query(`SELECT count(*) n FROM ${table} t WHERE t::text LIKE '%'||$1||'%'`, [needle])).rows[0].n);
    return n;
  };

  it('B2: the provisioned runtime can run every résumé entrypoint, no helper, no table, and readiness passes', async () => {
    const can = async (signature: string) => (await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok', [runtime, `public.${signature}`])).rows[0].ok;
    // Independent of the allowlist: every résumé routine the web routes and worker call.
    const called = ['snapshot(bigint,jsonb)', 'resolve(bigint,jsonb)', 'enqueue(bigint,jsonb)', 'status(bigint,uuid)', 'claim(uuid)',
      'prepare(jsonb)', 'transfer_store(jsonb,jsonb)', 'transfer_finish(jsonb,jsonb)', 'fail(jsonb,text)', 'paid_reserve(jsonb)',
      'paid_dispatch(jsonb)', 'paid_settle(jsonb)', 'paid_hold(jsonb)', 'paid_release_unsent(jsonb)', 'locator(bigint,integer)',
      'register_object(bigint,jsonb)', 'object_read(bigint,uuid)', 'retry(bigint,jsonb)', 'retry_status(bigint,uuid)',
      'extraction_cache(jsonb,jsonb)'].map(s => `flow_candidate_source_${s}`);
    expect([...RESUME_SOURCE_RUNTIME_FUNCTIONS].sort()).toEqual([...called].sort());
    for (const signature of called) expect([signature, await can(signature)]).toEqual([signature, true]);
    // The worker's text cache runs through the real role (refused for a bogus lease, not for permissions).
    const cache = await app.query('SELECT flow_candidate_source_extraction_cache($1,NULL) result',
      [JSON.stringify({ commandId: randomUUID(), claimToken: randomUUID(), generation: 1 })]).then(() => 'ok', (e: { code?: string }) => e.code);
    expect(cache).not.toBe('42501');
    for (const signature of SOURCE_OWNER_FUNCTIONS.filter(s => !(SOURCE_RUNTIME_FUNCTIONS as readonly string[]).includes(s)))
      expect([signature, await can(signature)]).toEqual([signature, false]);
    await expect(app.query('SELECT * FROM candidate_source_jobs LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('SELECT * FROM candidate_source_paid_operations LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    expect(await sourcePrivilegesReady(app as never, runtime, true)).toBe(true);
    // A grant outside the allowlist makes readiness refuse.
    await db.query(`GRANT EXECUTE ON FUNCTION public.flow_candidate_source_owner(bigint) TO ${runtime}`);
    try { expect(await sourcePrivilegesReady(app as never, runtime, true)).toBe(false); }
    finally { await db.query(`REVOKE EXECUTE ON FUNCTION public.flow_candidate_source_owner(bigint) FROM ${runtime}`); }
  });

  it('native résumé → proposal → stored transfer → receipt, with the email used only for scrubbing', async () => {
    const f = await start(docxBytes);
    const claim = await claimFor(f.commandId);
    expect(claim.scrubContext).toEqual({ verifiedAccountEmail: email(f.actor.userId) });
    const { d, calls } = deps();
    const result = await processResumeSource(claim.lease, d);
    expect(result.result).toBe('review_ready');
    expect(calls.model).toBe(1);
    const status = await repo.status(f.actor, f.commandId);
    expect(status).toMatchObject({ state: 'review_ready' });
    expect(status.proposalId).not.toBeNull();
    const t = verifyStoredTransfer(calls.delivered[0]!);
    expect(t).toMatchObject({ commandId: f.commandId, subjectId: f.actor.subjectId, bindingId: f.actor.bindingId, sourceId: f.snapshot.sourceId });
    const { validateSourceReceipt } = await import('/home/ews/ealana-index/candidate-parallel-lock-20261030/contracts.mjs' as string);
    expect(validateSourceReceipt(JSON.parse(calls.delivered[0]!.canonical), (await d.deliver!(calls.delivered[0]!, new AbortController().signal)).receipt)).toBeTruthy();
    expect(await rowsMentioning(email(f.actor.userId))).toBe(0);
  });

  it('a lost transfer is retried on a new lease without buying the model again, with byte-identical bytes', async () => {
    const f = await start(docxBytes);
    const { ResumeTransferError } = await import('./resume-source-client');
    const sentFirst: StoredTransfer[] = [];
    const first = deps({ deliver: async stored => { sentFirst.push(stored); throw new ResumeTransferError('delivery_outcome_unknown'); } });
    expect((await processResumeSource((await claimFor(f.commandId)).lease, first.d)).result).toBe('retry');
    expect(first.calls.model).toBe(1);
    await expireLease(f.commandId);
    const again = await claimFor(f.commandId);
    expect(again.lease.generation).toBeGreaterThan(1);
    const second = deps();
    expect((await processResumeSource(again.lease, second.d)).result).toBe('review_ready');
    expect(second.calls.model).toBe(0);
    expect(second.calls.delivered).toEqual(sentFirst);
  });

  it('a mixed PDF reserves only its image-only page through the real gate and settles OCR', async () => {
    const f = await start(pdfBytes);
    const { d, calls } = deps({ inner: 'scanned' });
    expect((await processResumeSource((await claimFor(f.commandId)).lease, d)).result).toBe('review_ready');
    expect(calls.model).toBe(1);
    const ops = (await db.query('SELECT kind, state, to_jsonb(t)::text j FROM candidate_source_paid_operations t WHERE command_id=$1', [f.commandId])).rows;
    expect(ops.map(o => `${o.kind}:${o.state}`).sort()).toEqual(['ocr:settled', 'semantic_model:settled']);
    const ocrOp = JSON.stringify(JSON.parse(ops.find(o => o.kind === 'ocr')!.j));
    expect(ocrOp).toContain('"pageCount":1,'); expect(ocrOp).toContain('"pageNumbers":[2]'); expect(ocrOp).toContain('"totalPageCount":3');
    expect(verifyStoredTransfer(calls.delivered[0]!).text).toContain('Skills: Go, PostgreSQL, Kafka');
  });

  it('an uncertain OCR read is held, never released, and "Try again" makes exactly one new attempt', async () => {
    const f = await start(pdfBytes);
    const failing = deps({ inner: 'ocr_fails' });
    expect((await processResumeSource((await claimFor(f.commandId)).lease, failing.d)).result).toBe('held');
    expect(failing.calls.model).toBe(0);
    const held = (await db.query("SELECT kind, state FROM candidate_source_paid_operations WHERE command_id=$1", [f.commandId])).rows;
    expect(held).toEqual([{ kind: 'ocr', state: 'held' }]);
    const after = await repo.status(f.actor, f.commandId);
    expect(['unavailable', 'held']).toContain(after.state);
    const offer = await repo.retryStatus(f.actor, f.commandId);
    expect(offer).toMatchObject({ attemptsUsed: 1, maxAttempts: 3, canRetry: true, message: 'Something went wrong processing your résumé.' });
    const key = randomUUID();
    const successor = await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: key, retryOfCommandId: f.commandId });
    expect(successor.commandId).not.toBe(f.commandId);
    expect((await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: key, retryOfCommandId: f.commandId })).commandId).toBe(successor.commandId);
    const ok = deps({ inner: 'scanned' });
    expect((await processResumeSource((await claimFor(successor.commandId)).lease, ok.d)).result).toBe('review_ready');
    expect(ok.calls.model).toBe(1);
    // Each attempt is its own paid slot; the first held slot is untouched.
    expect((await db.query("SELECT state FROM candidate_source_paid_operations WHERE command_id=$1", [f.commandId])).rows).toEqual([{ state: 'held' }]);
  });
  it('budget refusal crosses the real repository contract with zero tries and succeeds after allowance returns', async () => {
    const f = await start(docxBytes), refused = deps({ inner: 'native' });
    await db.query('UPDATE candidate_source_ai_policy SET enabled=false');
    try {
      await processResumeSource((await claimFor(f.commandId)).lease, refused.d);
      expect(refused.calls.model).toBe(0);
      expect(await repo.retryStatus(f.actor, f.commandId)).toMatchObject({ attemptsUsed: 0, canRetry: true });
    } finally { await db.query('UPDATE candidate_source_ai_policy SET enabled=true'); }
    const successor = await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), retryOfCommandId: f.commandId });
    const ok = deps({ inner: 'native' });
    expect((await processResumeSource((await claimFor(successor.commandId)).lease, ok.d)).result).toBe('review_ready');
    expect(ok.calls.model).toBe(1);
  });

  it('AI fails after a successful OCR: one Try again reuses the OCR and buys only a new AI attempt (unified retry)', async () => {
    const f = await start(pdfBytes);
    let ocrRuns = 0;
    const countingScan = (async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
      await opts.beforeOcr({ schemaVersion: 1, contentHash: sha(pdfBytes), totalPages: 3, pageNumbers: [2] });
      ocrRuns++; // only reached when the gate granted a new paid OCR dispatch
      return { success: true, text: RESUME, method: 'google_vision_ocr' as const, providerCalls: 1 };
    });
    const withScan = (over: Partial<ResumeProcessorDependencies>) => {
      const x = deps(over);
      x.d.extract = ((input: unknown, bytes: Buffer, d: Parameters<typeof extractResumeSource>[2]) =>
        extractResumeSource(input, bytes, { ...d, extract: countingScan as never })) as typeof extractResumeSource;
      return x;
    };
    const failing = withScan({ model: async () => { throw new Error('503'); } });
    expect((await processResumeSource((await claimFor(f.commandId)).lease, failing.d)).result).toBe('held');
    expect(ocrRuns).toBe(1);
    const offer = await repo.retryStatus(f.actor, f.commandId);
    expect(offer).toMatchObject({ attemptsUsed: 1, canRetry: true, message: 'Something went wrong processing your résumé.' });
    const successor = await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), retryOfCommandId: f.commandId });
    const ok = withScan({});
    expect((await processResumeSource((await claimFor(successor.commandId)).lease, ok.d)).result).toBe('review_ready');
    expect(ocrRuns).toBe(1); // the completed OCR was reused, not bought again
    expect(ok.calls.model).toBe(1);
    const ops = (await db.query(`SELECT command_id::text c, kind, state FROM candidate_source_paid_operations
      WHERE command_id = ANY($1::uuid[]) ORDER BY kind, state`, [[f.commandId, successor.commandId]])).rows;
    expect(ops.filter((o: any) => o.kind === 'ocr')).toEqual([{ c: f.commandId, kind: 'ocr', state: 'settled' }]);
    expect(ops.filter((o: any) => o.kind === 'semantic_model').map((o: any) => [o.c === f.commandId ? 'first' : 'retry', o.state]).sort())
      .toEqual([['first', 'held'], ['retry', 'settled']]);
  });

  it('B3: a Spark scan is read once under the budget and the library row reuses that complete text', async () => {
    const f = await start(pdfBytes);
    const library = async () => (await db.query('SELECT extracted_text t FROM candidate_resumes WHERE id=$1', [f.resumeId])).rows[0].t;
    await db.query("UPDATE candidate_resumes SET extracted_text='' WHERE id=$1", [f.resumeId]);
    expect(await library()).toBe(''); // the Spark upload stored the scan without OCR (empty = waiting)
    let ocrRuns = 0;
    const countingScan = (async (_b: Buffer, opts: { beforeOcr: (plan?: unknown) => Promise<void> }) => {
      await opts.beforeOcr({ schemaVersion: 1, contentHash: sha(pdfBytes), totalPages: 3, pageNumbers: [2] });
      ocrRuns++;
      return { success: true, text: RESUME, method: 'google_vision_ocr' as const, providerCalls: 1 };
    });
    const withScan = (over: Partial<ResumeProcessorDependencies>) => {
      const x = deps(over);
      x.d.extract = ((input: unknown, bytes: Buffer, d: Parameters<typeof extractResumeSource>[2]) =>
        extractResumeSource(input, bytes, { ...d, extract: countingScan as never })) as typeof extractResumeSource;
      return x;
    };
    // AI fails after the OCR: the library already has the complete text.
    expect((await processResumeSource((await claimFor(f.commandId)).lease, withScan({ model: async () => { throw new Error('503'); } }).d)).result).toBe('held');
    const saved = await library();
    expect(saved).toContain('Skills: Go, PostgreSQL, Kafka');
    expect(saved).toContain('Acme Payments');
    expect(saved).not.toContain(email(f.actor.userId));
    // AI-only Try again: no second OCR, no second charge, library unchanged.
    const successor = await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), retryOfCommandId: f.commandId });
    expect((await processResumeSource((await claimFor(successor.commandId)).lease, withScan({}).d)).result).toBe('review_ready');
    expect(ocrRuns).toBe(1);
    const ocr = (await db.query(`SELECT state FROM candidate_source_paid_operations WHERE kind='ocr' AND command_id = ANY($1::uuid[])`,
      [[f.commandId, successor.commandId]])).rows;
    expect(ocr).toEqual([{ state: 'settled' }]);
    expect(await library()).toBe(saved);
  });

  it('B3: library text that already exists is never overwritten', async () => {
    const f = await start(pdfBytes);
    await db.query("UPDATE candidate_resumes SET extracted_text='kept as uploaded' WHERE id=$1", [f.resumeId]);
    const { d } = deps({ inner: 'scanned' });
    expect((await processResumeSource((await claimFor(f.commandId)).lease, d)).result).toBe('review_ready');
    expect((await db.query('SELECT extracted_text t FROM candidate_resumes WHERE id=$1', [f.resumeId])).rows[0].t).toBe('kept as uploaded');
  });

  it('Try again stops after 3 attempts per résumé file', async () => {
    const f = await start(pdfBytes);
    let command = f.commandId;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const failing = deps({ inner: 'ocr_fails' });
      expect((await processResumeSource((await claimFor(command)).lease, failing.d)).result).toBe('held');
      const offer = await repo.retryStatus(f.actor, command);
      expect(offer.attemptsUsed).toBe(attempt);
      if (attempt < 3) {
        expect(offer.canRetry).toBe(true);
        command = (await repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), retryOfCommandId: command })).commandId;
      } else {
        expect(offer).toMatchObject({ canRetry: false, reason: 'attempt_limit',
          message: "We still couldn't process your résumé. Please upload a different file or fill in your profile yourself." });
        await expect(repo.retry(f.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), retryOfCommandId: command }))
          .rejects.toBeInstanceOf(ResumeSourceRepositoryError);
      }
    }
  });

  it('another candidate cannot read, queue or retry someone else\'s source', async () => {
    const f = await start(docxBytes);
    const other = await candidate(docxBytes);
    await expect(repo.status(other.actor, f.commandId)).rejects.toBeInstanceOf(ResumeSourceRepositoryError);
    await expect(repo.enqueue(other.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), sourceId: f.snapshot.sourceId, sourceVersion: 1 }))
      .rejects.toBeInstanceOf(ResumeSourceRepositoryError);
    await expect(objects.snapshot(other.actor, { schemaVersion: 1, idempotencyKey: randomUUID(), resumeId: f.resumeId })).rejects.toThrow();
  });
});
